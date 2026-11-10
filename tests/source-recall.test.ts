import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import { registerSourceRecallTool } from "../src/memory/recall-tool.js";
import { sourceReferenceLine } from "../src/memory/source-recall.js";
import { Runtime } from "../src/runtime.js";

type SourceRange = { sessionId: string; firstEntryId: string; lastEntryId: string };

function appendUser(manager: SessionManager, text: string): string {
	return manager.appendMessage({ role: "user", content: [{ type: "text", text }] } as any);
}

function persistSession(manager: SessionManager): void {
	manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "session flush" }] } as any);
}

function registerTool(runtime: Runtime, sessionsRoot: string) {
	const tools = new Map<string, any>();
	const pi = { registerTool: (definition: any) => tools.set(definition.name, definition) } as any;
	registerSourceRecallTool(pi, runtime, sessionsRoot);
	return tools.get("recall_source");
}

function invoke(tool: any, current: SessionManager, sourceRange: SourceRange, extra: Record<string, unknown> = {}) {
	return tool.execute("call-1", { sourceRange, ...extra }, undefined, undefined, { sessionManager: current });
}

describe("recall_source tool", () => {
	let temp: string;
	let runtime: Runtime;
	const managers: SessionManager[] = [];

	function createSession(sessionsRoot: string, name: string): SessionManager {
		const manager = SessionManager.create(join(temp, name), join(sessionsRoot, name));
		managers.push(manager);
		return manager;
	}

	function setupMemory(range: SourceRange): string {
		const memoryRoot = join(temp, ".memory", "current-session");
		mkdirSync(memoryRoot, { recursive: true });
		writeFileSync(join(memoryRoot, "facts.md"), `# Facts\n\nA remembered fact.\n${sourceReferenceLine(range)}\n`);
		runtime = new Runtime();
		runtime.enabled = true;
		runtime.memoryRoot = memoryRoot;
		return memoryRoot;
	}

	afterEach(() => {
		runtime?.abortAllWorkers();
		managers.splice(0);
		if (temp) rmSync(temp, { recursive: true, force: true });
	});

	it("returns only the stored range in bounded pages and expands with its cursor", async () => {
		temp = mkdtempSync(join(tmpdir(), "om-source-recall-"));
		const sessionsRoot = join(temp, "sessions");
		const source = createSession(sessionsRoot, "source");
		appendUser(source, "outside-before-secret");
		const first = appendUser(source, `first-in-range:${"a".repeat(700)}`);
		const middle = appendUser(source, "middle-in-range");
		const last = appendUser(source, "last-in-range");
		appendUser(source, "outside-after-secret");
		persistSession(source);
		const range = { sessionId: source.getSessionId(), firstEntryId: first, lastEntryId: last };
		setupMemory(range);
		const tool = registerTool(runtime, sessionsRoot);

		let cursor: { entryId: string; characterOffset: number } | undefined;
		let allPages = "";
		let pageCount = 0;
		do {
			const response = await invoke(tool, source, range, { maxChars: 256, ...(cursor ? { cursor } : {}) });
			const text = response.content[0].text as string;
			expect(text.length).toBeLessThanOrEqual(450);
			expect(text).not.toContain("outside-before-secret");
			expect(text).not.toContain("outside-after-secret");
			expect(response.details.returnedEntryIds.every((id: string) => [first, middle, last].includes(id))).toBe(true);
			allPages += text;
			cursor = response.details.nextCursor;
			pageCount++;
		} while (cursor && pageCount < 12);

		expect(pageCount).toBeGreaterThan(1);
		expect(cursor).toBeUndefined();
		expect(allPages).toContain("first-in-range:");
		expect(allPages).toContain("middle-in-range");
		expect(allPages).toContain("last-in-range");
	});

	it("allows a stored source session in the current session's parent lineage only", async () => {
		temp = mkdtempSync(join(tmpdir(), "om-source-parent-"));
		const sessionsRoot = join(temp, "sessions");
		const source = createSession(sessionsRoot, "source");
		const first = appendUser(source, "parent source first");
		const last = appendUser(source, "parent source last");
		persistSession(source);
		const parentFile = source.getSessionFile()!;
		const child = createSession(sessionsRoot, "child");
		child.newSession({ parentSession: parentFile });
		const range = { sessionId: source.getSessionId(), firstEntryId: first, lastEntryId: last };
		setupMemory(range);
		const tool = registerTool(runtime, sessionsRoot);

		const response = await invoke(tool, child, range, { maxChars: 1000 });
		expect(response.content[0].text).toContain("parent source first");
		expect(response.content[0].text).toContain("parent source last");

		const unrelated = createSession(sessionsRoot, "unrelated");
		const unrelatedEntry = appendUser(unrelated, "unrelated-secret-content");
		const unrelatedRange = {
			sessionId: unrelated.getSessionId(),
			firstEntryId: unrelatedEntry,
			lastEntryId: unrelatedEntry,
		};
		writeFileSync(join(runtime.memoryRoot, "facts.md"), `Unrelated fact.\n${sourceReferenceLine(unrelatedRange)}\n`);
		const denied = await invoke(tool, child, unrelatedRange);
		expect(denied.content[0].text).toMatch(/Source unavailable:.*unavailable in this session's lineage/);
		expect(denied.content[0].text).not.toContain("unrelated-secret-content");
	});

	it("reports missing sessions and invalid cursors without failing memory use", async () => {
		temp = mkdtempSync(join(tmpdir(), "om-source-missing-"));
		const sessionsRoot = join(temp, "sessions");
		const current = createSession(sessionsRoot, "current");
		const range = { sessionId: "unavailable-session", firstEntryId: "source-a", lastEntryId: "source-b" };
		setupMemory(range);
		const tool = registerTool(runtime, sessionsRoot);

		const unavailable = await invoke(tool, current, range);
		expect(unavailable.content[0].text).toMatch(/Source unavailable:.*unavailable in this session's lineage/);

		const source = createSession(sessionsRoot, "source");
		const first = appendUser(source, "available source fact");
		const availableRange = { sessionId: source.getSessionId(), firstEntryId: first, lastEntryId: first };
		writeFileSync(join(runtime.memoryRoot, "facts.md"), `Fact.\n${sourceReferenceLine(availableRange)}\n`);
		const invalidCursor = await invoke(tool, source, availableRange, {
			cursor: { entryId: "outside-range-entry", characterOffset: 0 },
		});
		expect(invalidCursor.content[0].text).toMatch(/Source unavailable:.*continuation cursor is outside/);
	});
});
