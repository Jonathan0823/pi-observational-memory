import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
	getAgentDir,
	parseSessionEntries,
	type SessionManager,
	type SessionEntry,
	type SessionHeader,
} from "@earendil-works/pi-coding-agent";

import { isSourceEntry } from "../ledger/progress.js";
import type { Entry, ObservationSourceRange } from "../ledger/types.js";
import { listTopics } from "./paths.js";
import { serializeSourceAddressedBranchEntries } from "../ledger/serialize.js";

export type SourceRecallCursor = {
	entryId: string;
	characterOffset: number;
};

export type SourceRecallPage = {
	text: string;
	returnedEntryIds: string[];
	nextCursor?: SourceRecallCursor;
};

export type SourceRecallResult =
	| { available: true; page: SourceRecallPage }
	| { available: false; reason: string };

export const DEFAULT_SOURCE_RECALL_CHARS = 6_000;
export const MAX_SOURCE_RECALL_CHARS = 12_000;
const MIN_SOURCE_RECALL_CHARS = 256;
const MAX_SOURCE_RECALL_ENTRIES = 6;
const MAX_SESSION_ANCESTRY = 32;
const MAX_REFERENCE_FIELD_CHARS = 256;
type SourceSessionManager = Pick<SessionManager, "getHeader" | "getEntries">;

function isSafeSourceRange(range: ObservationSourceRange): boolean {
	return [range.sessionId, range.firstEntryId, range.lastEntryId].every(
		(value) => value.length > 0 && value.length <= MAX_REFERENCE_FIELD_CHARS && !/[\r\n]/.test(value),
	);
}

/** Stable, exact text form stored next to a fact in a durable topic file. */
export function sourceReferenceLine(range: ObservationSourceRange): string {
	return `Source: session=${range.sessionId}; entries=${range.firstEntryId}..${range.lastEntryId}`;
}

function topicFilesContainReference(memoryRoot: string, range: ObservationSourceRange): boolean {
	const reference = sourceReferenceLine(range);
	for (const topic of listTopics(memoryRoot)) {
		try {
			if (readFileSync(join(memoryRoot, topic.filename), "utf-8").includes(reference)) return true;
		} catch {
			// A topic file disappearing during lookup simply means the reference is unavailable.
		}
	}
	return false;
}

function safeParentPath(sessionsRoot: string, parentPath: string): string | undefined {
	try {
		const root = realpathSync(sessionsRoot);
		const file = realpathSync(resolve(parentPath));
		const rel = relative(root, file);
		if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
		return file;
	} catch {
		return undefined;
	}
}

/** Resolve only the active session and its recorded parent lineage, never arbitrary session IDs. */
function findSessionEntriesInLineage(
	current: SourceSessionManager,
	sessionId: string,
	sessionsRoot: string,
): SessionEntry[] | undefined {
	let header: SessionHeader | null = current.getHeader();
	let entries = current.getEntries();
	const visited = new Set<string>();

	for (let depth = 0; depth < MAX_SESSION_ANCESTRY; depth++) {
		if (header?.id === sessionId) return entries;
		const parentPath = header?.parentSession;
		if (!parentPath) return undefined;
		const safePath = safeParentPath(sessionsRoot, parentPath);
		if (!safePath || visited.has(safePath)) return undefined;
		visited.add(safePath);
		try {
			const fileEntries = parseSessionEntries(readFileSync(safePath, "utf-8"));
			header = (fileEntries.find((entry) => entry.type === "session") as SessionHeader | undefined) ?? null;
			if (!header) return undefined;
			entries = fileEntries.filter((entry) => entry.type !== "session") as SessionEntry[];
		} catch {
			return undefined;
		}
	}
	return undefined;
}

function entriesInSourceRange(
	entries: SessionEntry[],
	range: ObservationSourceRange,
): SessionEntry[] | undefined {
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	const first = byId.get(range.firstEntryId);
	let cursor = byId.get(range.lastEntryId);
	if (!first || !cursor || !isSourceEntry(first as Entry) || !isSourceEntry(cursor as Entry)) return undefined;

	const reversed: SessionEntry[] = [];
	while (cursor) {
		reversed.push(cursor);
		if (cursor.id === first.id) return reversed.reverse().filter((entry) => isSourceEntry(entry as Entry));
		if (!cursor.parentId) break;
		cursor = byId.get(cursor.parentId);
	}
	return undefined;
}

function sourcePage(entries: SessionEntry[], cursor: SourceRecallCursor | undefined, requestedChars: number): SourceRecallPage | undefined {
	const rendered = entries.map((entry) => ({
		entry,
		text: serializeSourceAddressedBranchEntries([entry as Entry]).text,
	}));
	if (rendered.length === 0) return undefined;

	let startIndex = 0;
	let startOffset = 0;
	if (cursor) {
		startIndex = rendered.findIndex(({ entry }) => entry.id === cursor.entryId);
		if (startIndex < 0) return undefined;
		startOffset = cursor.characterOffset;
		if (!Number.isInteger(startOffset) || startOffset < 0 || startOffset > rendered[startIndex].text.length) return undefined;
	}

	const maxChars = Math.min(MAX_SOURCE_RECALL_CHARS, Math.max(MIN_SOURCE_RECALL_CHARS, requestedChars));
	let text = "";
	let nextCursor: SourceRecallCursor | undefined;
	const returnedEntryIds: string[] = [];

	for (let index = startIndex; index < rendered.length; index++) {
		const { entry, text: entryText } = rendered[index];
		const offset = index === startIndex ? startOffset : 0;
		if (offset === entryText.length) continue;
		if (returnedEntryIds.length >= MAX_SOURCE_RECALL_ENTRIES) {
			nextCursor = { entryId: entry.id, characterOffset: offset };
			break;
		}

		const separator = text.length > 0 ? "\n\n" : "";
		const continuation = offset > 0 ? `[continued source entry ${entry.id} at character ${offset}]\n` : "";
		const prefix = separator + continuation;
		const availableChars = maxChars - text.length - prefix.length;
		if (availableChars <= 0) {
			nextCursor = { entryId: entry.id, characterOffset: offset };
			break;
		}

		const excerpt = entryText.slice(offset, offset + availableChars);
		text += prefix + excerpt;
		returnedEntryIds.push(entry.id);
		if (offset + excerpt.length < entryText.length) {
			nextCursor = { entryId: entry.id, characterOffset: offset + excerpt.length };
			break;
		}

		const following = rendered[index + 1];
		if (following && text.length >= maxChars) {
			nextCursor = { entryId: following.entry.id, characterOffset: 0 };
			break;
		}
	}

	return { text, returnedEntryIds, ...(nextCursor ? { nextCursor } : {}) };
}

/** Read one exact, topic-file-stored source range with bounded output and an explicit continuation cursor. */
export function readSourceRangePage(
	current: SourceSessionManager,
	memoryRoot: string,
	sessionsRoot: string,
	range: ObservationSourceRange,
	cursor?: SourceRecallCursor,
	maxChars = DEFAULT_SOURCE_RECALL_CHARS,
): SourceRecallResult {
	if (!isSafeSourceRange(range)) {
		return { available: false, reason: "The source range is malformed." };
	}
	if (!existsSync(memoryRoot) || !topicFilesContainReference(memoryRoot, range)) {
		return { available: false, reason: "This source range is not present in durable session memory." };
	}
	const sessionEntries = findSessionEntriesInLineage(current, range.sessionId, sessionsRoot);
	if (!sessionEntries) {
		return { available: false, reason: `Source session ${range.sessionId} is unavailable in this session's lineage.` };
	}
	const sourceEntries = entriesInSourceRange(sessionEntries, range);
	if (!sourceEntries) {
		return { available: false, reason: "The referenced source range is unavailable or no longer exists on one source-session branch." };
	}
	const page = sourcePage(sourceEntries, cursor, maxChars);
	if (!page) return { available: false, reason: "The requested continuation cursor is outside the referenced source range." };
	return { available: true, page };
}

/** Default allowlist root: pi's global session directory. */
export function defaultSessionsRoot(): string {
	return join(getAgentDir(), "sessions");
}
