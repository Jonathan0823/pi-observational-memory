import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OM_WORKER_COST, totalWorkerCost, type Entry } from "../src/ledger/index.js";
import { readWorkerCost, workerCostPath, writeWorkerCost } from "../src/spawn/runs.js";
import { StatusController, type StatusUI } from "../src/ui/status-controller.js";

function costEntry(id: string, cost: unknown, role: unknown = "observer"): Entry {
	return { type: "custom", id, customType: OM_WORKER_COST, data: { role, runId: id, cost } };
}

describe("worker usage accounting", () => {
	it("totals valid costs across the complete supplied session tree and ignores bad entries", () => {
		const allBranches = [
			costEntry("observer-1", 0.12),
			costEntry("consolidator-1", 0.03, "consolidator"),
			costEntry("missing", undefined),
			costEntry("string", "1"),
			costEntry("nan", Number.NaN),
			costEntry("infinity", Number.POSITIVE_INFINITY),
			costEntry("negative", -1),
			costEntry("bad-role", 5, "other"),
		] as Entry[];
		expect(totalWorkerCost(allBranches)).toBeCloseTo(0.15);
	});

	describe("worker cost IPC", () => {
		let dir: string;
		beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "om-cost-")); });
		afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

		it("round-trips valid cost and tolerates missing or malformed files", () => {
			const path = workerCostPath(dir, "run-1");
			expect(path).toContain("run-1.cost.json");
			expect(readWorkerCost(path)).toBeUndefined();
			writeWorkerCost(path, 0.025);
			expect(readWorkerCost(path)).toBe(0.025);
			writeFileSync(path, JSON.stringify({ cost: -2 }));
			expect(readWorkerCost(path)).toBeUndefined();
			writeFileSync(path, "not json");
			expect(readWorkerCost(path)).toBeUndefined();
		});
	});

	it("renders total spend in the footer", () => {
		const status = new Map<string, string | undefined>();
		const ui: StatusUI = { setStatus: (key, text) => status.set(key, text), setWidget: () => {}, theme: { fg: (_c, text) => text } };
		const controller = new StatusController();
		controller.attach(ui);
		controller.setTotalCost(1.23456);
		expect(status.get("om")).toBe("om  $1.2346");
		controller.setTotalCost(Number.NaN);
		expect(status.get("om")).toBe("om");
	});
});
