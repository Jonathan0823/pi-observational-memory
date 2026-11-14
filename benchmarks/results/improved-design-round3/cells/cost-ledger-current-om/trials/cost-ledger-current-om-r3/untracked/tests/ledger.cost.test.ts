import { describe, expect, it } from "vitest";
import { buildWorkerCostData, OM_WORKER_COST, totalWorkerCost } from "../src/ledger/index.js";
import { readWorkerCost, writeWorkerCost } from "../src/spawn/runs.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const entry = (data: unknown) => ({ type: "custom", customType: OM_WORKER_COST, id: "cost", data });

describe("worker usage cost", () => {
	it("aggregates every valid cost entry, including entries outside the active branch", () => {
		expect(totalWorkerCost([
			entry({ role: "observer", runId: "a", cost: 0.12 }),
			{ ...entry({ role: "consolidator", runId: "b", cost: 0.34 }), id: "other-branch" },
		])).toBeCloseTo(0.46);
	});

	it("ignores missing, malformed, non-finite, and negative costs", () => {
		expect(totalWorkerCost([
			entry({}), entry({ cost: "1" }), entry({ cost: Number.NaN }),
			entry({ cost: Number.POSITIVE_INFINITY }), entry({ cost: -1 }),
			entry(null),
		])).toBe(0);
		expect(buildWorkerCostData("observer", "r", Number.NaN)).toBeUndefined();
		expect(buildWorkerCostData("bogus", "r", 1)).toBeUndefined();
	});

	it("recovers valid costs from worker IPC even if observations are absent", () => {
		const dir = mkdtempSync(join(tmpdir(), "om-cost-"));
		try {
			const path = join(dir, "run.json");
			writeWorkerCost(path, 0.025);
			expect(readWorkerCost(path)).toBe(0.025);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects malformed cost IPC", () => {
		const dir = mkdtempSync(join(tmpdir(), "om-cost-"));
		try {
			const path = join(dir, "run.json");
			writeWorkerCost(path, -1);
			expect(readWorkerCost(path)).toBeUndefined();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
