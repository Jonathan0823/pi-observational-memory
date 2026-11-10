import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { totalWorkerCost, OM_WORKER_COST } from "../src/ledger/index.js";
import { readWorkerUsage, usageResultPath, writeWorkerUsage } from "../src/spawn/runs.js";
import { StatusController, type StatusUI } from "../src/ui/status-controller.js";

const cost = (id: string, value: unknown) => ({ type: "custom", id, customType: OM_WORKER_COST, data: { role: "observer", runId: id, cost: value } });

describe("worker usage cost", () => {
	it("aggregates valid costs from the full supplied session entry set and ignores invalid data", () => {
		const entries = [cost("a", 0.25), cost("b", 1), cost("c", -1), cost("d", Infinity), cost("e", "2"), { ...cost("f", 5), data: { role: "bad", runId: "f", cost: 5 } }, cost("g", NaN)];
		expect(totalWorkerCost(entries)).toBe(1.25);
	});

	it("writes and recovers usage through the worker side channel", () => {
		const cwd = mkdtempSync(join(tmpdir(), "om-cost-"));
		try {
			const path = usageResultPath(cwd, "run");
			writeWorkerUsage(path, 0.123);
			expect(readWorkerUsage(path)).toEqual({ cost: 0.123 });
			expect(JSON.parse(readFileSync(path, "utf8")).cost).toBe(0.123);
			expect(readWorkerUsage(join(cwd, "missing"))).toBeUndefined();
		} finally { rmSync(cwd, { recursive: true, force: true }); }
	});

	it("shows the total in the footer", () => {
		const statuses = new Map<string, string | undefined>();
		const ui: StatusUI = { setStatus: (key, value) => statuses.set(key, value), setWidget: () => {}, theme: { fg: (_color, text) => text } };
		const status = new StatusController();
		status.attach(ui);
		status.setTotalCost(1.25);
		expect(statuses.get("om")).toContain("$1.2500");
	});
});
