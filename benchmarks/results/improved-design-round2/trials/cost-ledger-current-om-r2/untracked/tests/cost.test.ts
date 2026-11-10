import { describe, expect, it } from "vitest";

import { OM_WORKER_COST, totalWorkerCost } from "../src/ledger/index.js";
import type { Entry } from "../src/ledger/index.js";
import { StatusController, type StatusUI } from "../src/ui/status-controller.js";

function costEntry(id: string, data: unknown): Entry {
	return { type: "custom", id, customType: OM_WORKER_COST, data };
}

describe("worker cost accounting", () => {
	it("aggregates valid costs across branches and ignores malformed values", () => {
		const entries = [
			costEntry("a", { runId: "r1", role: "observer", cost: 0.125 }),
			costEntry("b", { runId: "r2", role: "consolidator", cost: 0.25 }),
			costEntry("c", { runId: "r3", role: "observer", cost: Number.NaN }),
			costEntry("d", { runId: "r4", role: "observer", cost: -1 }),
			costEntry("e", { runId: "r5", role: "observer", cost: Infinity }),
			costEntry("f", { role: "observer", cost: 10 }),
		] as Entry[];
		expect(totalWorkerCost(entries)).toBe(0.375);
	});

	it("renders the accumulated cost in the footer", () => {
		const statuses = new Map<string, string | undefined>();
		const ui: StatusUI = {
			setStatus: (key, text) => statuses.set(key, text),
			setWidget: () => {},
			theme: { fg: (_color, text) => text },
		};
		const status = new StatusController();
		status.attach(ui);
		status.setGauges({ nextValue: 0, nextMax: 1, poolValue: 0, poolMax: 1, ctxValue: 0, ctxMax: 1, totalCost: 1.23456 });
		expect(statuses.get("om")).toContain("$1.2346");
		status.detach();
	});
});
