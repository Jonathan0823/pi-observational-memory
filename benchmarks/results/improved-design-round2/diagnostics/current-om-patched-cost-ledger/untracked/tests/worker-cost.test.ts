import { describe, expect, it } from "vitest";
import { OM_WORKER_COST, totalWorkerCost, type Entry } from "../src/ledger/index.js";
import { readWorkerCost, writeWorkerCost } from "../src/spawn/runs.js";
import { StatusController, type StatusUI } from "../src/ui/status-controller.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("worker costs", () => {
	it("aggregates validated costs from all entries/branches and ignores invalid data", () => {
		const entry = (id: string, data: unknown): Entry => ({ type: "custom", id, customType: OM_WORKER_COST, data });
		expect(totalWorkerCost([
			entry("a", { role: "observer", runId: "a", cost: 0.25 }),
			entry("b", { role: "consolidator", runId: "b", cost: 1.5 }),
			entry("c", { role: "observer", runId: "c", cost: Number.NaN }),
			entry("d", { role: "observer", runId: "d", cost: -1 }),
			entry("e", { role: "observer", runId: "e", cost: "2" }),
			entry("f", undefined),
		])).toBe(1.75);
	});

	it("hands off finite worker cost through result IPC", () => {
		const dir = mkdtempSync(join(tmpdir(), "om-cost-"));
		try {
			const path = join(dir, "cost.json");
			writeWorkerCost(path, 0.123);
			expect(readWorkerCost(path)).toBe(0.123);
			writeWorkerCost(path, Number.POSITIVE_INFINITY);
			expect(readWorkerCost(path)).toBe(0.123);
			expect(readWorkerCost(join(dir, "missing"))).toBeUndefined();
		} finally { rmSync(dir, { recursive: true, force: true }); }
	});

	it("shows the session worker total in the footer", () => {
		const status = new Map<string, string | undefined>();
		const ui: StatusUI = { setStatus: (key, text) => status.set(key, text), setWidget: () => {}, theme: { fg: (_c, text) => text } };
		const controller = new StatusController();
		controller.attach(ui);
		controller.setGauges({ nextValue: 0, nextMax: 10, poolValue: 0, poolMax: 10, ctxValue: 0, ctxMax: 10, cost: 1.25 });
		expect(status.get("om")).toContain("$1.2500");
	});
});
