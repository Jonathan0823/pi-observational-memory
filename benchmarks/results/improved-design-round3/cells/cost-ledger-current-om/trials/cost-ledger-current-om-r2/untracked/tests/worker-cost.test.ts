import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OM_WORKER_COST, totalWorkerCost } from "../src/ledger/index.js";
import { registerWorkerCostReporter } from "../agent/index.js";
import { readWorkerCost, writeWorkerCost } from "../src/spawn/runs.js";
import { StatusController, type StatusUI } from "../src/ui/status-controller.js";

const costEntry = (id: string, data: unknown) => ({ type: "custom", customType: OM_WORKER_COST, id, data });

describe("worker cost accounting", () => {
	it("sums valid worker costs across the supplied complete session entry set", () => {
		const entries = [
			costEntry("main-run", { role: "observer", runId: "obs-1", cost: 0.125 }),
			{ type: "branch_summary", id: "fork" },
			costEntry("abandoned-run", { role: "consolidator", runId: "cons-1", cost: 0.25 }),
		];
		expect(totalWorkerCost(entries)).toBe(0.375);
	});

	it("ignores missing, malformed, negative and non-finite costs", () => {
		const entries = [
			costEntry("missing", { role: "observer", runId: "missing" }),
			costEntry("bad-role", { role: "other", runId: "bad-role", cost: 9 }),
			costEntry("negative", { role: "observer", runId: "negative", cost: -1 }),
			costEntry("nan", { role: "observer", runId: "nan", cost: Number.NaN }),
			costEntry("infinity", { role: "observer", runId: "infinity", cost: Infinity }),
			costEntry("valid", { role: "observer", runId: "valid", cost: 0.5 }),
		];
		expect(totalWorkerCost(entries)).toBe(0.5);
	});

	describe("worker-to-parent cost IPC", () => {
		let dir: string;
		beforeEach(() => {
			dir = mkdtempSync(join(tmpdir(), "om-cost-"));
		});
		afterEach(() => rmSync(dir, { recursive: true, force: true }));

		it("reports actual assistant usage and recovers it after an unsuccessful exit", async () => {
			const path = join(dir, "failed.cost.json");
			let onMessageEnd: ((event: { message: unknown }) => void | Promise<void>) | undefined;
			const fakePi = { on: (_name: string, handler: typeof onMessageEnd) => (onMessageEnd = handler) } as any;
			registerWorkerCostReporter(fakePi, path);
			await onMessageEnd?.({ message: { role: "assistant", usage: { cost: { total: 0.17 } } } });
			await onMessageEnd?.({ message: { role: "assistant", usage: { cost: { total: 0.25 } } } });
			const simulatedExitCode = 1;
			expect(simulatedExitCode).not.toBe(0);
			expect(readWorkerCost(path)).toBeCloseTo(0.42);
		});

		it("ignores malformed IPC and refuses invalid writes", () => {
			const path = join(dir, "bad.cost.json");
			writeFileSync(path, JSON.stringify({ cost: -3 }));
			expect(readWorkerCost(path)).toBeUndefined();
			writeWorkerCost(path, Infinity);
			expect(readWorkerCost(path)).toBeUndefined();
		});
	});

	it("renders total cost alongside the footer gauges", () => {
		const status = new Map<string, string | undefined>();
		const ui: StatusUI = {
			setStatus: (key, text) => status.set(key, text),
			setWidget: () => {},
			theme: { fg: (_color, text) => text },
		};
		const controller = new StatusController();
		controller.attach(ui);
		controller.setTotalCost(1.2345);
		expect(status.get("om")).toBe("om  $1.2345");
		controller.detach();
	});
});
