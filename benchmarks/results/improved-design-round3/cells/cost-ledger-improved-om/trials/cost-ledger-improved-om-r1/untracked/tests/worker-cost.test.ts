import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isWorkerCostEntry, OM_WORKER_COST, recordWorkerCost, totalWorkerCost } from "../src/ledger/costs.js";
import { readWorkerUsage, usageResultPath, writeWorkerUsage } from "../src/spawn/runs.js";

const costEntry = (role: unknown, runId: unknown, cost: unknown) => ({
	type: "custom", id: String(Math.random()), customType: OM_WORKER_COST, data: { role, runId, cost },
});

describe("worker cost ledger", () => {
	it("aggregates valid costs from entries on every branch", () => {
		const entries: any[] = [
			costEntry("observer", "a", 0.12),
			costEntry("consolidator", "b", 0.03),
			costEntry("observer", "bad", Number.NaN),
			costEntry("observer", "negative", -1),
			costEntry("invalid-role", "role", 4),
			{ type: "custom", customType: OM_WORKER_COST, data: { role: "observer", runId: "missing" } },
		];
		expect(totalWorkerCost(entries)).toBeCloseTo(0.15);
		expect(isWorkerCostEntry(entries[0])).toBe(true);
		for (const entry of entries.slice(2)) expect(isWorkerCostEntry(entry)).toBe(false);
	});
});

describe("worker usage IPC", () => {
	let dir: string;
	beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "om-cost-")); });
	 afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

	it("hands valid worker usage to the session ledger with role and run identity", () => {
		writeWorkerUsage(usageResultPath(dir, "cons-7"), 0.25);
		const appended: unknown[][] = [];
		const cost = recordWorkerCost((...args) => appended.push(args), dir, "consolidator", "cons-7");
		expect(cost).toBe(0.25);
		expect(appended).toEqual([[OM_WORKER_COST, { role: "consolidator", runId: "cons-7", cost: 0.25 }]]);
	});

	it("round-trips a valid cost from the run-specific usage file", () => {
		const path = usageResultPath(dir, "obs-1");
		writeWorkerUsage(path, 0.0042);
		expect(readWorkerUsage(path)).toEqual({ cost: 0.0042 });
	});

	it("ignores absent, malformed, non-finite, negative, and non-numeric costs", () => {
		expect(readWorkerUsage(join(dir, "absent"))).toBeUndefined();
		const path = join(dir, "bad.json");
		for (const content of ["{", "{}", JSON.stringify({ cost: "1" }), JSON.stringify({ cost: -1 }), JSON.stringify({ cost: null })]) {
			writeFileSync(path, content);
			expect(readWorkerUsage(path)).toBeUndefined();
		}
	});
});
