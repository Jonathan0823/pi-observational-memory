import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { totalWorkerCost, OM_WORKER_COST } from "../src/ledger/index.js";
import { readWorkerCost, writeWorkerCost } from "../src/spawn/runs.js";
import { StatusController, type StatusUI } from "../src/ui/status-controller.js";

const costEntry = (id: string, data: unknown) => ({ type: "custom", customType: OM_WORKER_COST, id, data });

describe("worker cost accounting", () => {
	it("adds valid ledger costs across supplied branches and ignores invalid costs", () => {
		const entries = [
			costEntry("a", { role: "observer", runId: "r1", cost: 0.12 }),
			costEntry("b", { role: "consolidator", runId: "r2", cost: 0.03 }),
			costEntry("c", { role: "observer", runId: "r3", cost: -1 }),
			costEntry("d", { role: "observer", runId: "r4", cost: Number.NaN }),
			costEntry("e", { role: "bogus", runId: "r5", cost: 2 }),
			costEntry("f", { role: "observer", runId: "r6", cost: "1" }),
		] as any[];
		expect(totalWorkerCost(entries)).toBeCloseTo(0.15);
	});

	it("persists cost while retaining observer IPC and reads it on unsuccessful runs", () => {
		const dir = mkdtempSync(join(tmpdir(), "om-cost-"));
		try {
			const path = join(dir, "run.json");
			writeWorkerCost(path, 0.25);
			expect(readWorkerCost(path)).toBe(0.25);
			expect(JSON.parse(readFileSync(path, "utf8")).cost).toBe(0.25);
			expect(readWorkerCost(join(dir, "missing"))).toBeUndefined();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("renders accumulated cost in the footer", () => {
		const states = new Map<string, string | undefined>();
		const ui: StatusUI = { setStatus: (key, text) => states.set(key, text), setWidget: () => {}, theme: { fg: (_c, text) => text } };
		const status = new StatusController();
		status.attach(ui);
		status.setTotalCost(1.23456);
		expect(states.get("om")).toBe("om  $1.2346");
	});
});
