import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OM_WORKER_COST, totalWorkerCost, type Entry } from "../src/ledger/index.js";
import { readWorkerCost, runCostPath, writeWorkerCost } from "../src/spawn/runs.js";
import { StatusController, type StatusUI } from "../src/ui/status-controller.js";

const cost = (id: string, value: unknown): Entry => ({ type: "custom", id, customType: OM_WORKER_COST, data: value });

describe("worker usage costs", () => {
	it("totals valid worker costs across branches and ignores malformed values", () => {
		const entries = [
			cost("a", { role: "observer", runId: "a", cost: 0.12 }),
			cost("b", { role: "consolidator", runId: "b", cost: 0.08 }),
			cost("c", { role: "observer", runId: "c", cost: Number.NaN }),
			cost("d", { role: "observer", runId: "d", cost: -1 }),
			cost("e", { role: "observer", runId: "e", cost: "1" }),
			cost("f", { role: "invalid", runId: "f", cost: 1 }),
		];
		expect(totalWorkerCost(entries)).toBeCloseTo(0.2);
	});

	it("hands valid costs to the parent through worker IPC and ignores malformed values", () => {
		const dir = mkdtempSync(join(tmpdir(), "om-cost-"));
		try {
			const path = runCostPath(dir, "run-1");
			writeWorkerCost(path, 0.42);
			expect(readWorkerCost(path)).toBe(0.42);
			writeWorkerCost(path, Number.NaN);
			expect(readWorkerCost(path)).toBe(0.42);
			expect(readWorkerCost(join(dir, "missing"))).toBeUndefined();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("renders total usage in the footer", () => {
		const status = new Map<string, string | undefined>();
		const ui: StatusUI = { setStatus: (key, text) => status.set(key, text), setWidget: () => {}, theme: { fg: (_c, text) => text } };
		const controller = new StatusController();
		controller.attach(ui);
		controller.setWorkerCost(0.237);
		expect(status.get("om")).toBe("om  $0.2370");
		controller.detach();
	});
});
