import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import { registerCompactionHook } from "../src/hooks/compaction-hook.js";
import { evaluateConsolidatorTrigger } from "../src/hooks/consolidator-trigger.js";
import { evaluateObserverTriggers } from "../src/hooks/observer-trigger.js";
import { foldLedger } from "../src/ledger/index.js";
import { registerSourceRecallTool } from "../src/memory/recall-tool.js";
import { sourceReferenceLine } from "../src/memory/source-recall.js";
import { Runtime } from "../src/runtime.js";
import { writeConsolidatorResult, writeObserverResult, writeWorkerCost } from "../src/spawn/runs.js";
import type { spawnWorker } from "../src/spawn/launch.js";

type Launch = Parameters<typeof spawnWorker>[0];
type TraceRecord = { event: string; data: Record<string, unknown> };

const workers: Array<{ role: string; runId: string }> = [];
let temp: string;
let runtime: Runtime | undefined;

function appendText(session: SessionManager, role: "user" | "assistant", text: string): string {
	return session.appendMessage({ role, content: [{ type: "text", text }] } as any);
}

afterEach(() => {
	runtime?.abortAllWorkers();
	rmSync(temp, { recursive: true, force: true });
	workers.length = 0;
});

describe("long-session memory lifecycle seam", () => {
	it("observes, consolidates, injects durable memory, and recalls its exact source", async () => {
		temp = mkdtempSync(join(tmpdir(), "om-memory-lifecycle-"));
		const cwd = join(temp, "project");
		const sessionsRoot = join(temp, "sessions");
		mkdirSync(cwd, { recursive: true });
		const session = SessionManager.create(cwd, sessionsRoot);
		const sourceEntryId = appendText(
			session,
			"user",
			"For the later feature, preserve the stable `session_id` field. We rejected path-derived IDs because forks can move between directories. The response must include the selected session id.",
		);
		const memoryRoot = join(cwd, ".memory", session.getSessionId());

		runtime = new Runtime();
		runtime.enabled = true;
		runtime.memoryRoot = memoryRoot;
		runtime.config = {
			...runtime.config,
			chunkTokens: 1,
			poolTargetTokens: 1,
			consolidateAtPoolTokens: 1,
			tailTokens: 100_000,
		};
		const trace: TraceRecord[] = [];
		runtime.diagnosticSink = (event, data) => trace.push({ event, data });

		const pi = {
			appendEntry: (customType: string, data: unknown) => session.appendCustomEntry(customType, data),
			on: () => undefined,
			registerTool: () => undefined,
		} as any;
		const ctx = {
			hasUI: false,
			cwd,
			sessionManager: session,
			getContextUsage: () => ({ tokens: 123 }),
		};
		const workerLauncher = async ({ env }: Launch) => {
			const role = env.OM_WORKER!;
			const runId = env.OM_RUN_ID!;
			workers.push({ role, runId });
			writeWorkerCost(env.OM_COST_PATH!, { costUsd: role === "observer" ? 0.001 : 0.002 });
			if (role === "observer") {
				writeObserverResult(env.OM_RESULT_PATH!, {
					observations: [
						{ timestamp: "2026-01-01 10:00", content: "Preserve stable session_id for forks." },
						{ timestamp: "2026-01-01 10:01", content: "Reject path-derived ids when directories change." },
					],
				});
			} else {
				const active = foldLedger(session.getBranch()).activeObservations;
				const promoted = active[0];
				const range = promoted?.sourceRange;
				expect(range).toMatchObject({
					sessionId: session.getSessionId(),
					firstEntryId: sourceEntryId,
					lastEntryId: sourceEntryId,
				});
				mkdirSync(memoryRoot, { recursive: true });
				writeFileSync(
					join(memoryRoot, "session-contract.md"),
					`---\nid: session-contract\ntitle: Session contract\nsummary: Stable identifiers for forks\nupdated: 2026-01-01\n---\nPreserve the stable session_id field. Reject path-derived IDs because forks can move between directories.\n${sourceReferenceLine(range!)}\n`,
				);
				writeConsolidatorResult(env.OM_RESULT_PATH!, {
					decisions: [{
						timestamp: promoted!.timestamp,
						outcome: "saved" as const,
						topicPath: "session-contract.md",
					}],
				});
			}
			return { code: 0, signal: null, stderr: "" };
		};

		evaluateObserverTriggers(pi, runtime, ctx, workerLauncher);
		await runtime.whenObserversIdle();
		expect(workers.map((worker) => worker.role)).toEqual(["observer"]);

		const observed = foldLedger(session.getBranch()).activeObservations;
		expect(observed).toHaveLength(2);
		expect(observed[0].sourceRange).toMatchObject({ sessionId: session.getSessionId(), firstEntryId: sourceEntryId, lastEntryId: sourceEntryId });

		const consolidation = evaluateConsolidatorTrigger(pi, runtime, ctx, workerLauncher);
		expect(consolidation).toBeDefined();
		await consolidation;
		expect(workers.map((worker) => worker.role)).toEqual(["observer", "consolidator"]);

		const laterPromptId = appendText(session, "user", "Implement the session lookup response now.");
		const handlers = new Map<string, (event: any, context: any) => unknown>();
		pi.on = (event: string, handler: (event: any, context: any) => unknown) => handlers.set(event, handler);
		registerCompactionHook(pi, runtime);
		const compact = handlers.get("session_before_compact");
		expect(compact).toBeDefined();
		const compacted = await compact!({ preparation: { firstKeptEntryId: laterPromptId, tokensBefore: 20_000 } }, ctx) as any;
		expect(compacted.compaction.summary).toContain("session-contract.md");
		expect(compacted.compaction.summary).toContain("Stable identifiers for forks");

		const tools = new Map<string, any>();
		pi.registerTool = (tool: any) => tools.set(tool.name, tool);
		registerSourceRecallTool(pi, runtime, sessionsRoot);
		const range = observed[0].sourceRange;
		const recall = await tools.get("recall_source").execute(
			"call-1",
			{ sourceRange: range, maxChars: 1_000 },
			undefined,
			undefined,
			{ sessionManager: session },
		);
		expect(recall.content[0].text).toContain("We rejected path-derived IDs");
		expect(recall.content[0].text).not.toContain("Implement the session lookup response now");
		const unavailable = await tools.get("recall_source").execute(
			"call-2",
			{ sourceRange: { ...range, sessionId: "unrelated-session" } },
			undefined,
			undefined,
			{ sessionManager: session },
		);
		expect(unavailable.content[0].text).toMatch(/Source unavailable:/);

		expect(trace.map((event) => event.event)).toEqual([
			"observer.started",
			"worker.cost_recorded",
			"observer.completed",
			"consolidator.started",
			"worker.cost_recorded",
			"consolidator.completed",
			"compaction.rendered",
			"source_recall.started",
			"source_recall.completed",
			"source_recall.started",
			"source_recall.unavailable",
		]);
		expect(trace.find((event) => event.event === "observer.completed")?.data).toMatchObject({
			observationCount: 2,
			sourceRange: { sessionId: session.getSessionId(), firstEntryId: sourceEntryId, lastEntryId: sourceEntryId },
		});
		expect(trace.find((event) => event.event === "consolidator.started")?.data).toMatchObject({
			thresholdTokens: 1,
			promotedObservationCount: 1,
		});
		expect(trace.find((event) => event.event === "consolidator.completed")?.data).toMatchObject({
			savedTopicPaths: ["session-contract.md"],
			savedTopicReferences: [{
				topicPath: "session-contract.md",
				sourceRange: { sessionId: session.getSessionId(), firstEntryId: sourceEntryId, lastEntryId: sourceEntryId },
			}],
		});
		expect(trace.find((event) => event.event === "compaction.rendered")?.data).toMatchObject({
			durableTopicCount: 1,
			observationCount: 1,
		});
		expect(trace.find((event) => event.event === "source_recall.completed")?.data).toMatchObject({
			returnedEntryCount: 1,
			sourceRange: range,
		});
		expect(readFileSync(join(memoryRoot, "INDEX.md"), "utf-8")).toContain("session-contract.md");
		expect(JSON.stringify(trace)).not.toContain("For the later feature");
		expect(JSON.stringify(trace)).not.toContain("rejected path-derived IDs");
	});
});
