import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { totalWorkerCost, OM_WORKER_COST, type Entry } from "../src/ledger/index.js";
import { readWorkerCost } from "../src/spawn/runs.js";
import { StatusController, type StatusUI } from "../src/ui/status-controller.js";

const entry = (data: unknown): Entry => ({ type: "custom", customType: OM_WORKER_COST, id: Math.random().toString(), data });

describe("worker cost accounting", () => {
	it("sums valid costs across the supplied full session entry list and ignores invalid values", () => {
		const entries = [
			entry({ role: "observer", runId: "a", cost: 0.12 }),
			entry({ role: "consolidator", runId: "b", cost: 0.03 }),
			entry({ role: "observer", runId: "bad", cost: Number.NaN }),
			entry({ role: "observer", runId: "bad", cost: -1 }),
			entry({ role: "observer", runId: "bad", cost: "1" }),
			entry({ role: "observer", runId: "bad" }),
			{ type: "custom", customType: "other", id: "x", data: { cost: 50 } },
		];
		expect(totalWorkerCost(entries)).toBeCloseTo(0.15);
	});

	it("reads valid persisted costs and treats missing or malformed IPC as absent", () => {
		const dir = mkdtempSync(join(tmpdir(), "om-cost-"));
		const path = join(dir, "cost.json");
		writeFileSync(path, JSON.stringify({ cost: 0.25 }));
		expect(readWorkerCost(path)).toBe(0.25);
		writeFileSync(path, JSON.stringify({ cost: Infinity }));
		expect(readWorkerCost(path)).toBeUndefined();
		expect(readWorkerCost(join(dir, "missing"))).toBeUndefined();
		rmSync(dir, { recursive: true, force: true });
	});

	it("shows accumulated spend in footer", () => {
		const statuses = new Map<string, string | undefined>();
		const ui: StatusUI = { setStatus: (k, v) => statuses.set(k, v), setWidget: () => {}, theme: { fg: (_c, text) => text } };
		const status = new StatusController();
		status.attach(ui);
		status.setTotalCost(1.23456);
		expect(statuses.get("om")).toContain("$1.2346");
	});
});
