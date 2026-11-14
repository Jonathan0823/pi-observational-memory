import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { foldLedger } from "../src/ledger/fold.js";
import { OM_WORKER_COST, type Entry } from "../src/ledger/types.js";
import { readObserverResult, readWorkerCost, writeObserverResult, writeWorkerCost } from "../src/spawn/runs.js";
import { StatusController, type StatusUI } from "../src/ui/status-controller.js";

function costEntry(id: string, cost: unknown, role: unknown = "observer"): Entry {
	return { type: "custom", id, customType: OM_WORKER_COST, data: { role, runId: id, cost } };
}

describe("worker cost ledger", () => {
	it("sums valid cost entries independently of other ledger data", () => {
		const folded = foldLedger([
			costEntry("a", 0.12),
			costEntry("b", 0.08, "consolidator"),
			costEntry("invalid", Number.NaN),
			costEntry("negative", -2),
			costEntry("malformed", "1"),
			{ type: "custom", id: "missing", customType: OM_WORKER_COST, data: { role: "observer", runId: "x" } },
		] as Entry[]);
		expect(folded.workerCost).toBeCloseTo(0.2);
	});
});

describe("worker result cost handoff", () => {
	let dir: string;
	beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "om-cost-")); });
	afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

	it("preserves cost alongside observer output and accepts cost-only unsuccessful runs", () => {
		const path = join(dir, "run.json");
		writeObserverResult(path, { observations: [] });
		writeWorkerCost(path, 0.456);
		expect(readObserverResult(path)).toEqual({ observations: [], cost: 0.456 });
		expect(readWorkerCost(path)).toBe(0.456);
		writeWorkerCost(join(dir, "failed.json"), 0.25);
		expect(readWorkerCost(join(dir, "failed.json"))).toBe(0.25);
	});

	it("ignores invalid costs", () => {
		const path = join(dir, "bad.json");
		writeObserverResult(path, { observations: [], cost: -1 });
		expect(readWorkerCost(path)).toBeUndefined();
		writeWorkerCost(path, Number.POSITIVE_INFINITY);
		expect(readWorkerCost(path)).toBeUndefined();
	});
});

describe("worker cost footer", () => {
	it("renders the aggregate amount even without gauges", () => {
		const status = new Map<string, string | undefined>();
		const ui: StatusUI = { setStatus: (key, value) => status.set(key, value), setWidget: () => {}, theme: { fg: (_color, text) => text } };
		const controller = new StatusController();
		controller.attach(ui);
		controller.setTotalCost(1.23456);
		expect(status.get("om")).toContain("$1.2346");
		controller.detach();
	});
});
