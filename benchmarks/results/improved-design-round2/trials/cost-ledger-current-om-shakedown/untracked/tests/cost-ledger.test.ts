import { describe, expect, it } from "vitest";
import { totalWorkerCost, type Entry, OM_WORKER_COST } from "../src/ledger/index.js";

describe("worker cost ledger", () => {
	it("sums valid costs from every supplied branch entry and ignores invalid values", () => {
		const entry = (id: string, cost: unknown): Entry => ({
			type: "custom",
			id,
			customType: OM_WORKER_COST,
			data: { cost },
		});
		expect(totalWorkerCost([
			entry("a", 0.12),
			entry("b", 0.38),
			entry("bad-negative", -1),
			entry("bad-infinite", Infinity),
			{ type: "custom", id: "other", customType: "other", data: { cost: 100 } },
		])).toBeCloseTo(0.5);
	});
});
