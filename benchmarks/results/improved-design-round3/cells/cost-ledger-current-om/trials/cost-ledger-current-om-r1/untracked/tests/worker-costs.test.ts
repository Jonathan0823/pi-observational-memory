import { describe, expect, it } from "vitest";

import { totalWorkerCost, workerCosts } from "../src/ledger/costs.js";
import { OM_WORKER_COST, type Entry } from "../src/ledger/types.js";

function costEntry(id: string, data: unknown): Entry {
	return { type: "custom", id, customType: OM_WORKER_COST, data };
}

describe("worker cost aggregation", () => {
	it("includes valid cost entries from the supplied all-branch entry collection", () => {
		const entries = [
			costEntry("main", { role: "observer", runId: "obs-1", cost: 0.12 }),
			costEntry("abandoned", { role: "consolidator", runId: "con-1", cost: 0.08 }),
			costEntry("also-abandoned", { role: "observer", runId: "obs-2", cost: 0 }),
		];
		expect(workerCosts(entries)).toHaveLength(3);
		expect(totalWorkerCost(entries)).toBeCloseTo(0.2);
	});

	it("ignores missing, malformed, non-finite, and negative costs", () => {
		const entries = [
			costEntry("missing", { role: "observer", runId: "a" }),
			costEntry("string", { role: "observer", runId: "b", cost: "0.5" }),
			costEntry("nan", { role: "observer", runId: "c", cost: Number.NaN }),
			costEntry("infinity", { role: "observer", runId: "d", cost: Number.POSITIVE_INFINITY }),
			costEntry("negative", { role: "consolidator", runId: "e", cost: -1 }),
			costEntry("bad-role", { role: "other", runId: "f", cost: 1 }),
			costEntry("valid", { role: "observer", runId: "g", cost: 0.25 }),
		];
		expect(totalWorkerCost(entries)).toBe(0.25);
	});
});
