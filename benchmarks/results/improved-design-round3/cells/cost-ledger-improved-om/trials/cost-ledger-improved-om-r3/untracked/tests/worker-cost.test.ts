import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { foldLedger, OM_WORKER_COST } from "../src/ledger/index.js";
import { readWorkerCost, writeWorkerCost } from "../src/spawn/runs.js";
import workerExtension from "../agent/index.js";
import { StatusController, type StatusUI } from "../src/ui/status-controller.js";

const costEntry = (id: string, data: unknown) => ({ type: "custom", customType: OM_WORKER_COST, id, data });

describe("worker cost accounting", () => {
	let dir: string;
	let env: Record<string, string | undefined>;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "om-cost-"));
		env = {
			OM_WORKER: process.env.OM_WORKER,
			OM_RESULT_PATH: process.env.OM_RESULT_PATH,
			OM_COST_PATH: process.env.OM_COST_PATH,
		};
	});
	afterEach(() => {
		for (const [key, value] of Object.entries(env)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		rmSync(dir, { recursive: true, force: true });
	});
	it("aggregates valid costs across the full session tree and ignores invalid records", () => {
		const entries: any[] = [
			costEntry("a", { role: "observer", runId: "r1", cost: 0.125 }),
			costEntry("b", { role: "consolidator", runId: "r2", cost: 0 }),
			costEntry("c", { role: "observer", runId: "r3", cost: -1 }),
			costEntry("d", { role: "observer", runId: "r4", cost: Number.NaN }),
			costEntry("e", { role: "observer", runId: "r5", cost: "2" }),
			costEntry("f", { role: "observer", runId: "r6" }),
		];
		const folded = foldLedger(entries);
		expect(folded.workerCosts).toEqual([0.125, 0]);
		expect(folded.workerCostTotal).toBe(0.125);
	});

	it("writes and recovers finite non-negative worker cost, ignoring absent or malformed IPC", () => {
		const path = join(dir, "worker.cost.json");
		writeWorkerCost(path, 0.42);
		expect(readWorkerCost(path)).toBe(0.42);
		writeFileSync(path, JSON.stringify({ cost: Number.POSITIVE_INFINITY }));
		expect(readWorkerCost(path)).toBeUndefined();
		writeFileSync(path, "not json");
		expect(readWorkerCost(path)).toBeUndefined();
		expect(readWorkerCost(join(dir, "missing"))).toBeUndefined();
	});

	it("captures usage messages incrementally so partial/error runs leave recoverable cost", async () => {
		const path = join(dir, "worker.cost.json");
		const handlers = new Map<string, (event: any) => unknown>();
		const pi: any = {
			on: (name: string, handler: (event: any) => unknown) => handlers.set(name, handler),
			registerTool: () => {},
		};
		process.env.OM_WORKER = "observer";
		process.env.OM_RESULT_PATH = join(dir, "result.json");
		process.env.OM_COST_PATH = path;
		workerExtension(pi);
		const onMessageEnd = handlers.get("message_end")!;
		await onMessageEnd({ message: { role: "assistant", usage: { cost: { total: 0.2 } }, stopReason: "error" } });
		expect(readWorkerCost(path)).toBe(0.2);
	});

	it("shows cumulative worker cost in the footer", () => {
		let footer: string | undefined;
		const ui: StatusUI = {
			setStatus: (_key, value) => (footer = value),
			setWidget: () => {},
			theme: { fg: (_color, text) => text },
		};
		const status = new StatusController();
		status.attach(ui);
		status.setWorkerCostTotal(0);
		expect(footer).toBe("om  $0.0000");
		status.setWorkerCostTotal(1.25);
		expect(footer).toBe("om  $1.2500");
	});
});
