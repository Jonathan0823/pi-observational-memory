import { describe, expect, it } from "vitest";

import { foldLedger, OM_WORKER_COST, type Entry } from "../src/ledger/index.js";

describe("worker cost ledger", () => {
	it("aggregates valid observer and consolidator costs on the supplied branch only", () => {
		const branch = [
			{ type: "custom", id: "c1", customType: OM_WORKER_COST, data: { role: "observer", runId: "r1", cost: 0.12 } },
			{ type: "custom", id: "c2", customType: OM_WORKER_COST, data: { role: "consolidator", runId: "r2", cost: 0.08 } },
		] as Entry[];
		const otherBranch = [
			{ type: "custom", id: "c3", customType: OM_WORKER_COST, data: { role: "observer", runId: "r3", cost: 9 } },
		] as Entry[];

		expect(foldLedger(branch).workerCostTotal).toBeCloseTo(0.2);
		expect(foldLedger(otherBranch).workerCostTotal).toBe(9);
	});

	it("ignores missing, malformed, non-finite, and negative cost entries", () => {
		const entries = [undefined, null, "0.1", Number.NaN, Number.POSITIVE_INFINITY, -0.1].map((cost, i) => ({
			type: "custom",
			id: `bad-${i}`,
			customType: OM_WORKER_COST,
			data: { role: "observer", runId: `r-${i}`, cost },
		})) as Entry[];
		entries.push({
			type: "custom",
			id: "bad-role",
			customType: OM_WORKER_COST,
			data: { role: "unknown", runId: "bad", cost: 4 },
		});
		entries.push({
			type: "custom",
			id: "bad-overflow",
			customType: OM_WORKER_COST,
			data: { role: "observer", runId: "large", cost: Number.MAX_VALUE },
		});
		entries.push({
			type: "custom",
			id: "bad-overflow-2",
			customType: OM_WORKER_COST,
			data: { role: "observer", runId: "large2", cost: Number.MAX_VALUE },
		});

		expect(foldLedger(entries).workerCostTotal).toBe(Number.MAX_VALUE);
	});
});
