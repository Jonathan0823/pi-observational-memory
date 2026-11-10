import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { evaluateConsolidatorTrigger } from "../src/hooks/consolidator-trigger.js";
import { foldLedger, OM_OBSERVATIONS_DROPPED } from "../src/ledger/index.js";
import type { Entry } from "../src/ledger/types.js";
import { Runtime } from "../src/runtime.js";
import type { spawnWorker } from "../src/spawn/launch.js";

type Report = { decisions: unknown[] };
type Launch = Parameters<typeof spawnWorker>[0];

const allObservations = [
	{ timestamp: "2026-06-25T14:30:00.000Z", content: "first fact", tokenCount: 10 },
	{ timestamp: "2026-06-25T14:31:00.000Z", content: "second fact", tokenCount: 10 },
	{ timestamp: "2026-06-25T14:32:00.000Z", content: "recent fact", tokenCount: 10 },
];

function reportForPromoted(): Report {
	return {
		decisions: [
			{ timestamp: allObservations[0].timestamp, outcome: "saved", topicPath: "auth.md" },
			{ timestamp: allObservations[1].timestamp, outcome: "discarded", reason: "superseded by newer policy" },
		],
	};
}

describe("consolidator report accounting through the trigger", () => {
	let temp: string;
	let memoryRoot: string;
	let runtime: Runtime;
	let branch: Entry[];
	let appendEntry: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		temp = mkdtempSync(join(tmpdir(), "om-cons-accounting-"));
		memoryRoot = join(temp, ".memory", "session-1");
		mkdirSync(memoryRoot, { recursive: true });
		runtime = new Runtime();
		runtime.enabled = true;
		runtime.memoryRoot = memoryRoot;
		runtime.config = { ...runtime.config, consolidateAtPoolTokens: 1, poolTargetTokens: 10 };
		branch = [
			{ type: "message", id: "source-1", timestamp: "2026-06-25T14:29:00.000Z" },
			{
				type: "custom",
				id: "recorded-1",
				customType: "om.observations.recorded",
				data: { observations: allObservations, coversUpToId: "source-1" },
			},
		];
		appendEntry = vi.fn((customType: string, data: unknown) => {
			branch.push({ type: "custom", id: `appended-${branch.length}`, customType, data });
		});
	});

	afterEach(() => {
		runtime.abortAllWorkers();
		rmSync(temp, { recursive: true, force: true });
	});

	function fakePi() {
		return { appendEntry } as any;
	}

	function fakeCtx() {
		return {
			hasUI: false,
			sessionManager: { getBranch: () => branch, getEntries: () => branch },
		};
	}

	function fakeWorker(report?: Report, existingFiles: string[] = []) {
		return async ({ env }: Launch) => {
			for (const file of existingFiles) writeFileSync(join(memoryRoot, file), "topic content\n");
			if (report !== undefined) {
				mkdirSync(join(memoryRoot, ".runs"), { recursive: true });
				writeFileSync(env.OM_RESULT_PATH!, JSON.stringify(report));
			}
			return { code: 0, signal: null, stderr: "" };
		};
	}

	it("drops only fully accounted observations after checking saved topic files", async () => {
		const task = evaluateConsolidatorTrigger(fakePi(), runtime, fakeCtx(), fakeWorker(reportForPromoted(), ["auth.md"]));
		expect(task).toBeDefined();
		await task;

		const dropped = branch.find((entry) => entry.type === "custom" && entry.customType === OM_OBSERVATIONS_DROPPED);
		expect(dropped?.data).toMatchObject({
			observationTimestamps: [allObservations[0].timestamp, allObservations[1].timestamp],
			coversUpToId: "source-1",
		});
		expect(foldLedger(branch).activeObservations.map((item) => item.timestamp)).toEqual([allObservations[2].timestamp]);
		expect(runtime.lastWorkerError).toBeUndefined();
	});

	it.each([
		["missing report", undefined, []],
		["missing observation reference", { decisions: [{ timestamp: allObservations[0].timestamp, outcome: "discarded", reason: "noise" }] }, []],
		[
			"discard without a reason",
			{
				decisions: [
					{ timestamp: allObservations[0].timestamp, outcome: "discarded", reason: "noise" },
					{ timestamp: allObservations[1].timestamp, outcome: "discarded", reason: "   " },
				],
			},
			[],
		],
		[
			"duplicate reference",
			{
				decisions: [
					{ timestamp: allObservations[0].timestamp, outcome: "discarded", reason: "noise" },
					{ timestamp: allObservations[0].timestamp, outcome: "discarded", reason: "duplicate" },
					{ timestamp: allObservations[1].timestamp, outcome: "discarded", reason: "noise" },
				],
			},
			[],
		],
		[
			"unknown reference",
			{
				decisions: [
					{ timestamp: allObservations[0].timestamp, outcome: "discarded", reason: "noise" },
					{ timestamp: "not-handed-to-worker", outcome: "discarded", reason: "unknown" },
				],
			},
			[],
		],
		[
			"missing topic file",
			{
				decisions: [
					{ timestamp: allObservations[0].timestamp, outcome: "saved", topicPath: "missing.md" },
					{ timestamp: allObservations[1].timestamp, outcome: "discarded", reason: "noise" },
				],
			},
			[],
		],
		[
			"topic path escaping the memory root",
			{
				decisions: [
					{ timestamp: allObservations[0].timestamp, outcome: "saved", topicPath: "../outside.md" },
					{ timestamp: allObservations[1].timestamp, outcome: "discarded", reason: "noise" },
				],
			},
			[],
		],
	])("keeps the promoted observations active and surfaces an error for %s", async (_case, report, files) => {
		const task = evaluateConsolidatorTrigger(fakePi(), runtime, fakeCtx(), fakeWorker(report as Report | undefined, files as string[]));
		expect(task).toBeDefined();
		await task;

		expect(branch.some((entry) => entry.type === "custom" && entry.customType === OM_OBSERVATIONS_DROPPED)).toBe(false);
		expect(foldLedger(branch).activeObservations.map((item) => item.timestamp)).toEqual(
			allObservations.map((item) => item.timestamp),
		);
		expect(runtime.lastWorkerError).toMatch(/consolidat|report|observation|topic/i);
	});
});
