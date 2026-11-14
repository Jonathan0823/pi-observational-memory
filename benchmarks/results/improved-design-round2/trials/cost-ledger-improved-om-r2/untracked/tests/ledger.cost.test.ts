import { describe, expect, it } from "vitest";
import { totalWorkerCost } from "../src/ledger/cost.js";
import { isWorkerCostEntryData, OM_WORKER_COST, type Entry } from "../src/ledger/types.js";

const cost = (runId: string, amount: unknown, role: unknown = "observer"): Entry => ({
	type: "custom",
	customType: OM_WORKER_COST,
	id: runId,
	data: { role, runId, cost: amount },
});

describe("worker cost ledger", () => {
	it("aggregates every valid run entry, including entries from abandoned branches", () => {
		const allSessionEntries = [cost("main-run", 0.125), cost("abandoned-run", 0.25, "consolidator")];
		expect(totalWorkerCost(allSessionEntries)).toBe(0.375);
	});

	it("ignores missing, malformed, non-finite, and negative costs", () => {
		expect(isWorkerCostEntryData({ role: "observer", runId: "x" })).toBe(false);
		expect(isWorkerCostEntryData({ role: "observer", runId: "x", cost: "1" })).toBe(false);
		expect(isWorkerCostEntryData({ role: "observer", runId: "x", cost: Number.NaN })).toBe(false);
		expect(isWorkerCostEntryData({ role: "observer", runId: "x", cost: Infinity })).toBe(false);
		expect(isWorkerCostEntryData({ role: "observer", runId: "x", cost: -1 })).toBe(false);
		expect(totalWorkerCost([cost("ok", 0.2), cost("bad", -1), cost("also-bad", Number.NaN)])).toBe(0.2);
	});
});
