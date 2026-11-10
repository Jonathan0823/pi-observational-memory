import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CONSOLIDATOR_SYSTEM } from "../agent/consolidator/prompt.js";
import { evaluateConsolidatorTrigger } from "../src/hooks/consolidator-trigger.js";
import type { Entry, Observation } from "../src/ledger/types.js";
import { Runtime } from "../src/runtime.js";
import type { spawnWorker } from "../src/spawn/launch.js";

const observations: Observation[] = [
	{
		timestamp: "2026-06-25T14:30:00.000Z",
		content: "first source-backed fact",
		tokenCount: 10,
		sourceRange: { sessionId: "origin-session", firstEntryId: "entry-a", lastEntryId: "entry-b" },
	},
	{ timestamp: "2026-06-25T14:31:00.000Z", content: "legacy fact without provenance", tokenCount: 10 },
	{
		timestamp: "2026-06-25T14:32:00.000Z",
		content: "second source-backed fact",
		tokenCount: 10,
		sourceRange: { sessionId: "origin-session", firstEntryId: "entry-c", lastEntryId: "entry-d" },
	},
	{ timestamp: "2026-06-25T14:33:00.000Z", content: "newest buffered fact", tokenCount: 10 },
];

type Launch = Parameters<typeof spawnWorker>[0];

describe("source ranges through durable consolidation", () => {
	let temp: string;
	let runtime: Runtime;
	let branch: Entry[];

	afterEach(() => {
		runtime?.abortAllWorkers();
		if (temp) rmSync(temp, { recursive: true, force: true });
	});

	it("keeps exact ranges beside their facts and does not invent provenance", async () => {
		temp = mkdtempSync(join(tmpdir(), "om-durable-source-"));
		const memoryRoot = join(temp, ".memory", "master-session");
		mkdirSync(memoryRoot, { recursive: true });
		runtime = new Runtime();
		runtime.enabled = true;
		runtime.memoryRoot = memoryRoot;
		runtime.config = { ...runtime.config, consolidateAtPoolTokens: 1, poolTargetTokens: 10 };
		branch = [
			{ type: "message", id: "source-tip", timestamp: "2026-06-25T14:29:00.000Z" },
			{
				type: "custom",
				id: "recorded-observations",
				customType: "om.observations.recorded",
				data: { observations, coversUpToId: "source-tip" },
			},
		];
		const pi = {
			appendEntry: (customType: string, data: unknown) => {
				branch.push({ type: "custom", id: `entry-${branch.length}`, customType, data });
			},
		} as any;
		const ctx = {
			hasUI: false,
			sessionManager: { getBranch: () => branch, getEntries: () => branch },
		};
		let kickoffPrompt = "";
		const fakeWorker: typeof spawnWorker = async ({ argv, env }: Launch) => {
			const promptIndex = argv.lastIndexOf("-p");
			kickoffPrompt = argv[promptIndex + 1] ?? "";
			const section = kickoffPrompt.split("===== OBSERVATIONS TO CONSOLIDATE (each line is `<timestamp-id> [optional source range]  <content>`) =====\n")[1]
				?.split("\n===== END OBSERVATIONS =====")[0];
			expect(section).toBeDefined();
			const facts = (section ?? "").split("\n").map((line) => {
				const match = line.match(/^\S+(?: \[source session:([^\s\]]+) entries:([^\s\]]+)\.\.([^\s\]]+)\])?  (.+)$/);
				expect(match).not.toBeNull();
				return {
					content: match?.[4] ?? "",
					sourceLine: match?.[1]
						? `  Source: session=${match[1]}; entries=${match[2]}..${match[3]}`
						: undefined,
				};
			});
			const topicContent = facts.map((fact) => `- ${fact.content}${fact.sourceLine ? `\n${fact.sourceLine}` : ""}`).join("\n");
			writeFileSync(join(memoryRoot, "project-facts.md"), topicContent);
			mkdirSync(join(memoryRoot, ".runs"), { recursive: true });
			writeFileSync(
				env.OM_RESULT_PATH!,
				JSON.stringify({
					decisions: observations.slice(0, 3).map((observation) => ({
						timestamp: observation.timestamp,
						outcome: "saved",
						topicPath: "project-facts.md",
					})),
				}),
			);
			return { code: 0, signal: null, stderr: "" };
		};

		const task = evaluateConsolidatorTrigger(pi, runtime, ctx, fakeWorker);
		expect(task).toBeDefined();
		await task;

		expect(kickoffPrompt).toContain("[source session:origin-session entries:entry-a..entry-b]");
		expect(kickoffPrompt).toContain("[source session:origin-session entries:entry-c..entry-d]");
		expect(CONSOLIDATOR_SYSTEM).toContain("durable session memory");
		expect(CONSOLIDATOR_SYSTEM).not.toMatch(/cross-session/i);
		expect(CONSOLIDATOR_SYSTEM).toContain("not project-wide memory");
		expect(CONSOLIDATOR_SYSTEM).toContain("never invent, edit, infer, or broaden a source range");

		const durableFacts = readFileSync(join(memoryRoot, "project-facts.md"), "utf-8");
		expect(durableFacts).toBe(
			"- first source-backed fact\n  Source: session=origin-session; entries=entry-a..entry-b\n" +
			"- legacy fact without provenance\n" +
			"- second source-backed fact\n  Source: session=origin-session; entries=entry-c..entry-d",
		);
		expect(durableFacts).not.toContain("Source: session=origin-session; entries=entry-a..entry-d");
	});
});
