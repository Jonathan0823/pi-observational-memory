/**
 * The consolidator's tool belt. `--no-builtin-tools` is set on the worker, so this extension
 * registers its own read/write/edit/ls/grep — all path-scoped to `.memory/` (design risk 6).
 * Topic-file edits and one structured accounting report form the output. The orchestrator
 * validates the report and destination files before tombstoning any handed observation.
 *
 * Scoping: every path argument is resolved against OM_MEMORY_DIR and rejected if it escapes
 * that directory, so a wayward model cannot read or clobber the user's project.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Static } from "typebox";
import { atomicWrite } from "../../src/memory/paths.js";
import { writeConsolidatorResult } from "../../src/spawn/runs.js";

type ToolText = { content: { type: "text"; text: string }[]; details: unknown };

function ok(text: string, details: unknown = {}): ToolText {
	return { content: [{ type: "text" as const, text }], details };
}

function fail(text: string): ToolText {
	return { content: [{ type: "text" as const, text: `Error: ${text}` }], details: { error: true } };
}

/** Resolve a requested path against the sandbox root, or return undefined if it escapes. */
function scoped(root: string, requested: string): string | undefined {
	const abs = resolve(root, requested);
	const rel = relative(root, abs);
	if (rel === "") return abs;
	if (rel.startsWith("..")) return undefined;
	return abs;
}

const ReadSchema = Type.Object({
	path: Type.String({ description: "Path inside .memory/, e.g. 'auth.md' or '.memory/auth.md'." }),
});
const WriteSchema = Type.Object({
	path: Type.String({ description: "Path inside .memory/ to (over)write, e.g. 'auth.md'." }),
	content: Type.String({ description: "Full file content, including YAML front-matter." }),
});
const EditSchema = Type.Object({
	path: Type.String({ description: "Path inside .memory/ to edit." }),
	oldText: Type.String({ description: "Exact text to replace (must occur exactly once)." }),
	newText: Type.String({ description: "Replacement text." }),
});
const LsSchema = Type.Object({
	path: Type.Optional(Type.String({ description: "Subdirectory inside .memory/. Defaults to .memory/ root." })),
});
const GrepSchema = Type.Object({
	pattern: Type.String({ description: "JavaScript regular expression to search for." }),
	path: Type.Optional(Type.String({ description: "Restrict to this file/subdir inside .memory/." })),
});
const ConsolidationReportSchema = Type.Object({
	decisions: Type.Array(
		Type.Union([
			Type.Object({
				timestamp: Type.String({ description: "Exact timestamp-id of one handed observation." }),
				outcome: Type.Literal("saved"),
				topicPath: Type.String({ description: "Relative topic-file path where the observation was saved." }),
			}),
			Type.Object({
				timestamp: Type.String({ description: "Exact timestamp-id of one handed observation." }),
				outcome: Type.Literal("discarded"),
				reason: Type.String({ description: "Why this observation was intentionally discarded." }),
			}),
		]),
	),
});

type ReadInput = Static<typeof ReadSchema>;
type WriteInput = Static<typeof WriteSchema>;
type EditInput = Static<typeof EditSchema>;
type LsInput = Static<typeof LsSchema>;
type GrepInput = Static<typeof GrepSchema>;
type ConsolidationReportInput = Static<typeof ConsolidationReportSchema>;

function listFilesRecursive(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		if (name.startsWith(".")) continue; // skip .runs and temp files
		const full = join(dir, name);
		if (statSync(full).isDirectory()) out.push(...listFilesRecursive(full));
		else out.push(full);
	}
	return out;
}

/** Register the consolidator's scoped file tools (read/write/edit/ls/grep), all under .memory/. */
export function registerConsolidatorTools(pi: ExtensionAPI, memoryRoot: string, reportPath: string): void {
	const root = resolve(memoryRoot);

	pi.registerTool({
		name: "read",
		label: "Read memory file",
		description: "Read a topic file under .memory/.",
		parameters: ReadSchema,
		async execute(_id: string, params: ReadInput): Promise<ToolText> {
			const abs = scoped(root, params.path);
			if (!abs) return fail("path escapes .memory/");
			if (!existsSync(abs)) return fail(`no such file: ${params.path}`);
			return ok(readFileSync(abs, "utf-8"));
		},
	});

	pi.registerTool({
		name: "write",
		label: "Write memory file",
		description: "Create or overwrite a topic file under .memory/ (atomic). Do not write INDEX.md.",
		parameters: WriteSchema,
		async execute(_id: string, params: WriteInput): Promise<ToolText> {
			const abs = scoped(root, params.path);
			if (!abs) return fail("path escapes .memory/");
			if (/(^|\/)INDEX\.md$/i.test(params.path)) return fail("INDEX.md is generated automatically; do not write it");
			atomicWrite(abs, params.content);
			return ok(`Wrote ${params.path} (${params.content.length} bytes).`);
		},
	});

	pi.registerTool({
		name: "edit",
		label: "Edit memory file",
		description: "Replace an exact substring in a topic file under .memory/ (atomic).",
		parameters: EditSchema,
		async execute(_id: string, params: EditInput): Promise<ToolText> {
			const abs = scoped(root, params.path);
			if (!abs) return fail("path escapes .memory/");
			if (/(^|\/)INDEX\.md$/i.test(params.path)) return fail("INDEX.md is generated automatically; do not edit it");
			if (!existsSync(abs)) return fail(`no such file: ${params.path}`);
			const current = readFileSync(abs, "utf-8");
			const occurrences = current.split(params.oldText).length - 1;
			if (occurrences === 0) return fail("oldText not found");
			if (occurrences > 1) return fail(`oldText is ambiguous (${occurrences} matches); add more context`);
			atomicWrite(abs, current.replace(params.oldText, params.newText));
			return ok(`Edited ${params.path}.`);
		},
	});

	pi.registerTool({
		name: "ls",
		label: "List memory files",
		description: "List files under .memory/.",
		parameters: LsSchema,
		async execute(_id: string, params: LsInput): Promise<ToolText> {
			const abs = scoped(root, params.path ?? ".");
			if (!abs) return fail("path escapes .memory/");
			if (!existsSync(abs)) return ok("(.memory/ is empty)");
			const entries = readdirSync(abs).filter((n) => !n.startsWith("."));
			return ok(entries.length > 0 ? entries.sort().join("\n") : "(empty)");
		},
	});

	pi.registerTool({
		name: "report_consolidation",
		label: "Account for consolidated observations",
		description: "Report every handed observation as saved to a topic file or intentionally discarded with a reason. Call once when all topic edits are complete.",
		parameters: ConsolidationReportSchema,
		async execute(_id: string, params: ConsolidationReportInput): Promise<ToolText> {
			writeConsolidatorResult(reportPath, { decisions: params.decisions });
			return ok(`Reported ${params.decisions.length} observation decisions.`);
		},
	});

	pi.registerTool({
		name: "grep",
		label: "Search memory files",
		description: "Search topic files under .memory/ with a regular expression.",
		parameters: GrepSchema,
		async execute(_id: string, params: GrepInput): Promise<ToolText> {
			let re: RegExp;
			try {
				re = new RegExp(params.pattern);
			} catch (e) {
				return fail(`invalid regex: ${(e as Error).message}`);
			}
			const base = scoped(root, params.path ?? ".");
			if (!base) return fail("path escapes .memory/");
			if (!existsSync(base)) return ok("(no matches)");
			const files = statSync(base).isDirectory() ? listFilesRecursive(base) : [base];
			const hits: string[] = [];
			for (const file of files) {
				const lines = readFileSync(file, "utf-8").split("\n");
				const relPath = relative(root, file);
				lines.forEach((line, i) => {
					if (re.test(line)) hits.push(`${relPath}:${i + 1}: ${line.trim()}`);
				});
				if (hits.length >= 200) break;
			}
			return ok(hits.length > 0 ? hits.join("\n") : "(no matches)");
		},
	});
}
