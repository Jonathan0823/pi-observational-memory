import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { totalWorkerCost, OM_WORKER_COST, type Entry } from "../src/ledger/index.js";
import { recordWorkerCost } from "../src/spawn/costs.js";
import { readWorkerCost, workerCostPath, writeWorkerCost } from "../src/spawn/runs.js";
import { StatusController, type StatusUI } from "../src/ui/status-controller.js";
import omWorker from "../agent/index.js";

const costEntry = (id: string, data: unknown): Entry => ({ type: "custom", customType: OM_WORKER_COST, id, data });

describe("worker cost ledger accounting", () => {
	it("aggregates worker costs across all supplied branches", () => {
		const allEntries = [
			costEntry("main", { role: "observer", runId: "obs-1", cost: 0.125 }),
			costEntry("fork", { role: "consolidator", runId: "cons-1", cost: 0.25 }),
		];
		expect(totalWorkerCost(allEntries)).toBeCloseTo(0.375);
	});

	it("ignores missing, malformed, non-finite, and negative costs", () => {
		const entries = [
			costEntry("missing", { role: "observer", runId: "a" }),
			costEntry("wrong", { role: "worker", runId: "b", cost: 2 }),
			costEntry("nan", { role: "observer", runId: "c", cost: Number.NaN }),
			costEntry("infinity", { role: "observer", runId: "d", cost: Infinity }),
			costEntry("negative", { role: "observer", runId: "e", cost: -1 }),
			costEntry("valid", { role: "observer", runId: "f", cost: 0.5 }),
		];
		expect(totalWorkerCost(entries)).toBe(0.5);
	});
});

describe("worker cost IPC handoff", () => {
	let cwd: string;
	beforeEach(() => {
		cwd = mkdtempSync(join(tmpdir(), "om-worker-cost-"));
	});
	afterEach(() => rmSync(cwd, { recursive: true, force: true }));

	it("recovers cumulative valid cost and appends a role/run-identified ledger entry", () => {
		const path = workerCostPath(cwd, "run-1");
		writeWorkerCost(path, { role: "observer", runId: "run-1", cost: 0.0123 });
		const appended: Array<{ type: string; data: unknown }> = [];
		const actual = recordWorkerCost({ appendEntry: (type: string, data?: unknown) => appended.push({ type, data }) } as any, cwd, "observer", "run-1");
		 expect(actual).toBe(0.0123);
		expect(appended).toEqual([{ type: OM_WORKER_COST, data: { role: "observer", runId: "run-1", cost: 0.0123 } }]);
	});

	it("rejects malformed, mismatched, and negative IPC data", () => {
		const path = workerCostPath(cwd, "run-2");
		writeWorkerCost(path, { role: "observer", runId: "run-2", cost: -1 });
		expect(readWorkerCost(path, "observer", "run-2")).toBeUndefined();
		writeWorkerCost(path, { role: "consolidator", runId: "run-2", cost: 1 });
		expect(readWorkerCost(path, "observer", "run-2")).toBeUndefined();
	});
});

describe("worker usage reporting", () => {
	it("writes actual assistant usage so the parent can recover it after any worker exit", () => {
		const cwd = mkdtempSync(join(tmpdir(), "om-worker-report-"));
		const oldEnv = { role: process.env.OM_WORKER, runId: process.env.OM_RUN_ID, costPath: process.env.OM_COST_PATH, resultPath: process.env.OM_RESULT_PATH };
		try {
			process.env.OM_WORKER = "observer";
			process.env.OM_RUN_ID = "run-report";
			process.env.OM_COST_PATH = workerCostPath(cwd, "run-report");
			process.env.OM_RESULT_PATH = join(cwd, "observations.json");
			const handlers = new Map<string, Function>();
			omWorker({ on: (event: string, handler: Function) => handlers.set(event, handler), registerTool: () => {} } as any);
			handlers.get("message_end")?.({ message: { role: "assistant", usage: { cost: { total: 0.045 } } } });
			expect(readWorkerCost(workerCostPath(cwd, "run-report"), "observer", "run-report")).toBe(0.045);
			handlers.get("message_end")?.({ message: { role: "assistant", usage: { cost: { total: -1 } } } });
			expect(readWorkerCost(workerCostPath(cwd, "run-report"), "observer", "run-report")).toBe(0.045);
		} finally {
			if (oldEnv.role === undefined) delete process.env.OM_WORKER; else process.env.OM_WORKER = oldEnv.role;
			if (oldEnv.runId === undefined) delete process.env.OM_RUN_ID; else process.env.OM_RUN_ID = oldEnv.runId;
			if (oldEnv.costPath === undefined) delete process.env.OM_COST_PATH; else process.env.OM_COST_PATH = oldEnv.costPath;
			if (oldEnv.resultPath === undefined) delete process.env.OM_RESULT_PATH; else process.env.OM_RESULT_PATH = oldEnv.resultPath;
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});

describe("worker cost footer display", () => {
	it("shows the accumulated cost beside the observational-memory status", () => {
		let footer = "";
		const ui: StatusUI = {
			setStatus: (_key, text) => { footer = text ?? ""; },
			setWidget: () => {},
			theme: { fg: (_color, text) => text },
		};
		const status = new StatusController();
		status.attach(ui);
		status.setTotalCost(1.23456);
		expect(footer).toContain("$1.2346");
	});
});
