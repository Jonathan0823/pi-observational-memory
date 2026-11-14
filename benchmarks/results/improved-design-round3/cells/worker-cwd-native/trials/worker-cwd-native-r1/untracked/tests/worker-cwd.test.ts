import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnWorkerMock } = vi.hoisted(() => ({ spawnWorkerMock: vi.fn() }));
vi.mock("../src/spawn/launch.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/spawn/launch.js")>()),
	spawnWorker: spawnWorkerMock,
}));

import { evaluateConsolidatorTrigger } from "../src/hooks/consolidator-trigger.js";
import { evaluateObserverTriggers } from "../src/hooks/observer-trigger.js";
import { DEFAULTS } from "../src/config.js";
import { observation, observationsRecordedEntry, rawMessage } from "./fixtures/session.js";
import { Runtime } from "../src/runtime.js";

let projectRoot: string;
let memoryRoot: string;

beforeEach(() => {
	projectRoot = mkdtempSync(join(tmpdir(), "om-worker-cwd-"));
	memoryRoot = join(projectRoot, ".memory", "session-1");
	spawnWorkerMock.mockReset().mockResolvedValue({ code: 1, signal: null, stderr: "expected test exit" });
});

afterEach(() => rmSync(projectRoot, { recursive: true, force: true }));

function runtime(): Runtime {
	const result = new Runtime();
	result.enabled = true;
	result.memoryRoot = memoryRoot;
	result.config = { ...DEFAULTS, chunkTokens: 1, consolidateAtPoolTokens: 1, poolTargetTokens: 0 };
	return result;
}

function context(branch: any[]) {
	return {
		cwd: projectRoot,
		hasUI: false,
		sessionManager: { getBranch: () => branch, getEntries: () => branch },
	};
}

describe("worker subprocess working directory", () => {
	it("creates the session memory root and launches observers from it", async () => {
		const rt = runtime();
		evaluateObserverTriggers({ appendEntry: vi.fn() } as any, rt, context([rawMessage("raw-1", "enough source text to trigger")]) as any);
		await rt.whenObserversIdle();

		expect(existsSync(memoryRoot)).toBe(true);
		expect(spawnWorkerMock).toHaveBeenCalledOnce();
		expect(spawnWorkerMock.mock.calls[0][0]).toMatchObject({ cwd: memoryRoot });
	});

	it("creates the session memory root and launches consolidators from it", async () => {
		const rt = runtime();
		const branch = [
			rawMessage("raw-1", "source"),
			observationsRecordedEntry("obs-1", {
				observations: [observation("t1", { tokenCount: 20 }), observation("t2", { tokenCount: 20 })],
				coversUpToId: "raw-1",
			}),
		];
		evaluateConsolidatorTrigger({ appendEntry: vi.fn() } as any, rt, context(branch) as any);
		await vi.waitFor(() => expect(spawnWorkerMock).toHaveBeenCalledOnce());

		expect(existsSync(memoryRoot)).toBe(true);
		expect(spawnWorkerMock.mock.calls[0][0]).toMatchObject({ cwd: memoryRoot });
	});
});
