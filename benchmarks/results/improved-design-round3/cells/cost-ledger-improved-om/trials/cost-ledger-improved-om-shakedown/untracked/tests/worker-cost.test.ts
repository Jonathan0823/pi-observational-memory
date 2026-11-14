import { describe, expect, it } from "vitest";
import { totalWorkerCost, OM_WORKER_COST, type Entry } from "../src/ledger/index.js";
import { readWorkerCost, writeWorkerCost } from "../src/spawn/runs.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StatusController } from "../src/ui/status-controller.js";

describe("worker usage cost", () => {
	it("sums valid records across branches and ignores invalid data", () => {
		const entries = [
			{ type: "custom", customType: OM_WORKER_COST, data: { role: "observer", runId: "a", cost: 0.25 } },
			{ type: "custom", customType: OM_WORKER_COST, data: { role: "consolidator", runId: "b", cost: 0.5 } },
			...[-1, Number.NaN, Number.POSITIVE_INFINITY, "1", undefined].map((cost) => ({
				type: "custom", customType: OM_WORKER_COST, data: { role: "observer", runId: "bad", cost },
			})),
		] as Entry[];
		expect(totalWorkerCost(entries)).toBe(0.75);
	});

	it("round-trips parent-readable run costs and ignores malformed files", () => {
		const dir = mkdtempSync(join(tmpdir(), "om-cost-"));
		try {
			const path = join(dir, "worker.cost.json");
			writeWorkerCost(path, { role: "observer", runId: "run-1", cost: 0.125 });
			expect(readWorkerCost(path)).toEqual({ role: "observer", runId: "run-1", cost: 0.125 });
			expect(readWorkerCost(join(dir, "missing.json"))).toBeUndefined();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("shows worker total in the footer", () => {
		let footer = "";
		const ui = { setStatus: (_key: string, text: string | undefined) => { footer = text ?? ""; }, setWidget: () => {}, theme: { fg: (_c: string, text: string) => text } };
		const status = new StatusController();
		status.attach(ui);
		status.setGauges({ nextValue: 0, nextMax: 10, poolValue: 0, poolMax: 10, ctxValue: 0, ctxMax: 10, workerCost: 1.23456 });
		expect(footer).toContain("$1.2346");
		status.detach();
	});
});
