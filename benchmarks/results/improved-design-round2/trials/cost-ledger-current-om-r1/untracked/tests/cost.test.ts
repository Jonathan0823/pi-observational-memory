import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { totalWorkerCost, type Entry } from "../src/ledger/index.js";
import { readWorkerCost, writeWorkerCost } from "../src/spawn/runs.js";
import { StatusController, type StatusUI } from "../src/ui/status-controller.js";

const costEntry = (id: string, cost: unknown): Entry => ({
	type: "custom",
	id,
	customType: "om.worker.cost",
	data: { runId: id, role: "observer", cost },
});

describe("worker cost ledger", () => {
	it("sums all valid cost records across supplied branches and ignores invalid values", () => {
		const entries = [
			costEntry("a", 0.12),
			costEntry("b", 0.08),
			costEntry("zero", 0),
			costEntry("nan", Number.NaN),
			costEntry("infinity", Number.POSITIVE_INFINITY),
			costEntry("negative", -1),
			{ ...costEntry("bad-role", 1), data: { runId: "bad-role", role: "other", cost: 1 } },
			{ ...costEntry("malformed", 1), data: null },
			{ ...costEntry("not-ledger", 10), customType: "unrelated" },
		] as Entry[];
		expect(totalWorkerCost(entries)).toBeCloseTo(0.2);
	});
});

describe("worker cost IPC", () => {
	let dir: string;
	beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "om-cost-"))));
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it("round-trips finite non-negative costs and tolerates missing or malformed files", () => {
		const path = join(dir, "worker.cost.json");
		expect(readWorkerCost(path)).toBeUndefined();
		writeWorkerCost(path, 1.2345);
		expect(readWorkerCost(path)).toBe(1.2345);
		writeWorkerCost(path, -2);
		expect(readWorkerCost(path)).toBe(1.2345);
		writeFileSync(path, JSON.stringify({ cost: Number.NaN }));
		expect(readWorkerCost(path)).toBeUndefined();
		writeFileSync(path, "{");
		expect(readWorkerCost(path)).toBeUndefined();
	});
});

describe("worker cost footer", () => {
	it("shows the cumulative cost alongside gauges", () => {
		const status = new Map<string, string | undefined>();
		const ui: StatusUI = {
			setStatus: (key, value) => status.set(key, value),
			setWidget: () => {},
			theme: { fg: (_color, text) => text },
		};
		const controller = new StatusController();
		controller.attach(ui);
		controller.setGauges({ nextValue: 0, nextMax: 10, poolValue: 0, poolMax: 10, ctxValue: 0, ctxMax: 10 });
		controller.setTotalCost(1.25);
		expect(status.get("om")).toContain("$1.2500");
		controller.detach();
	});
});
