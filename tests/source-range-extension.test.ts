import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { registerCompactionHook } from "../src/hooks/compaction-hook.js";
import { registerObserverTrigger } from "../src/hooks/observer-trigger.js";
import { foldLedger, fullProjection, visibleProjection, type Entry } from "../src/ledger/index.js";
import { Runtime } from "../src/runtime.js";
import type { spawnWorker } from "../src/spawn/launch.js";

const sourceSessionId = "immutable-source-session-id";
const sourceEntries: Entry[] = [
	{ type: "custom_message", id: "source-first", timestamp: "2026-06-25T14:30:00.000Z", content: "a".repeat(40) },
	{ type: "custom_message", id: "source-last", timestamp: "2026-06-25T14:31:00.000Z", content: "b".repeat(40) },
	{ type: "custom_message", id: "source-tail", timestamp: "2026-06-25T14:32:00.000Z", content: "c".repeat(40) },
];

type Handler = (event: unknown, ctx: any) => unknown;

describe("observer source ranges across recording and compaction", () => {
	let temp: string;
	let runtime: Runtime;
	let branch: Entry[];
	const handlers = new Map<string, Handler>();

	afterEach(() => {
		runtime?.abortAllWorkers();
		if (temp) rmSync(temp, { recursive: true, force: true });
		handlers.clear();
	});

	it("records immutable session and chunk bounds through ledger, projection, and compaction", async () => {
		temp = mkdtempSync(join(tmpdir(), "om-source-range-"));
		const memoryRoot = join(temp, ".memory", sourceSessionId);
		mkdirSync(memoryRoot, { recursive: true });
		runtime = new Runtime();
		runtime.enabled = true;
		runtime.memoryRoot = memoryRoot;
		runtime.configLoaded = true;
		runtime.config = { ...runtime.config, chunkTokens: 25, observerConcurrency: 1, tailTokens: 10 };
		branch = [...sourceEntries];

		const pi = {
			on: (event: string, handler: Handler) => handlers.set(event, handler),
			appendEntry: (customType: string, data: unknown) => {
				branch.push({ type: "custom", id: `ledger-${branch.length}`, customType, data });
			},
		} as any;
		const ctx = {
			hasUI: false,
			sessionManager: {
				getBranch: () => branch,
				getEntries: () => branch,
				getSessionId: () => sourceSessionId,
			},
		};
		const fakeWorker: typeof spawnWorker = async ({ env }) => {
			const resultPath = env.OM_RESULT_PATH!;
			mkdirSync(join(memoryRoot, ".runs"), { recursive: true });
			writeFileSync(
				resultPath,
				JSON.stringify({ observations: [{ timestamp: "2026-06-25 14:30", content: "a durable source-linked fact" }] }),
			);
			return { code: 0, signal: null, stderr: "" };
		};

		registerObserverTrigger(pi, runtime, fakeWorker);
		handlers.get("turn_end")?.({}, ctx);
		await runtime.whenObserversIdle();

		const recorded = foldLedger(branch).observations[0];
		const expectedRange = {
			sessionId: sourceSessionId,
			firstEntryId: "source-first",
			lastEntryId: "source-last",
		};
		expect(recorded?.sourceRange).toEqual(expectedRange);
		expect(fullProjection(branch, "ledger-3").observations[0]?.sourceRange).toEqual(expectedRange);

		registerCompactionHook(pi, runtime);
		const beforeCompact = handlers.get("session_before_compact");
		expect(beforeCompact).toBeDefined();
		const result = await beforeCompact?.(
			{ preparation: { firstKeptEntryId: "source-tail", tokensBefore: 100 } },
			{ ...ctx, cwd: temp, branchEntries: branch },
		);
		const compaction = (result as { compaction: { summary: string; firstKeptEntryId: string; details: any } }).compaction;
		expect(compaction.firstKeptEntryId).toBe("source-tail");
		expect(compaction.summary).toContain(
			"[source session:immutable-source-session-id entries:source-first..source-last]",
		);
		expect(compaction.details.observations[0].sourceRange).toEqual(expectedRange);

		const compactedBranch = [
			...branch,
			{ type: "compaction", id: "compaction-1", details: compaction.details } as Entry,
		];
		expect(visibleProjection(compactedBranch).observations[0]?.sourceRange).toEqual(expectedRange);
	});
});
