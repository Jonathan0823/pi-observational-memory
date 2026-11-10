import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OM_WORKER_COST } from "../src/ledger/types.js";
import { readWorkerCost, writeWorkerCost } from "../src/spawn/runs.js";
import { totalWorkerCost } from "../src/spawn/cost.js";

describe("worker costs", () => {
	let dir: string;
	beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "om-cost-")); });
	afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

	it("round trips finite nonnegative costs and ignores invalid IPC", () => {
		const path = join(dir, "cost.json");
		writeWorkerCost(path, 0.0123);
		expect(readWorkerCost(path)).toEqual({ cost: 0.0123 });
		for (const cost of ["bad", "null", "{\"cost\":-1}", "{\"cost\":1e999}", "{}"] ) {
			writeFileSync(path, cost);
			expect(readWorkerCost(path)).toBeUndefined();
		}
		expect(readWorkerCost(join(dir, "missing"))).toBeUndefined();
	});

	it("sums every valid cost record while ignoring malformed ledger data", () => {
		expect(totalWorkerCost([
			{ customType: OM_WORKER_COST, data: { cost: 0.1 } },
			{ customType: OM_WORKER_COST, data: { cost: 0.2 } },
			{ customType: OM_WORKER_COST, data: { cost: -1 } },
			{ customType: OM_WORKER_COST, data: { cost: Number.NaN } },
			{ customType: "other", data: { cost: 10 } },
		])).toBeCloseTo(0.3);
	});
});
