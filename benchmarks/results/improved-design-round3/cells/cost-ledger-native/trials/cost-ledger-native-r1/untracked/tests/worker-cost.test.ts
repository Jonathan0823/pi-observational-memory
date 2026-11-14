import { describe, expect, it } from "vitest";

import { totalWorkerCost, type Entry, OM_WORKER_COST } from "../src/ledger/index.js";
import { StatusController, type StatusUI } from "../src/ui/status-controller.js";

function costEntry(id: string, data: unknown): Entry {
	return { type: "custom", customType: OM_WORKER_COST, id, data };
}

describe("worker cost ledger", () => {
	it("sums valid worker costs across all supplied session entries", () => {
		const entries = [
			costEntry("a", { role: "observer", runId: "obs-1", cost: 0.125 }),
			{ type: "message", id: "branch-point" },
			costEntry("b", { role: "consolidator", runId: "cons-1", cost: 0.25 }),
		] as Entry[];
		expect(totalWorkerCost(entries)).toBe(0.375);
	});

	it("ignores missing, malformed, non-finite, and negative costs", () => {
		const entries = [
			costEntry("missing", { role: "observer", runId: "a" }),
			costEntry("string", { role: "observer", runId: "b", cost: "1" }),
			costEntry("nan", { role: "observer", runId: "c", cost: Number.NaN }),
			costEntry("infinity", { role: "observer", runId: "d", cost: Number.POSITIVE_INFINITY }),
			costEntry("negative", { role: "observer", runId: "e", cost: -1 }),
			costEntry("bad-role", { role: "other", runId: "f", cost: 1 }),
		] as Entry[];
		expect(totalWorkerCost(entries)).toBe(0);
	});
});

describe("worker spend footer", () => {
	it("renders the session cost beside the gauges", () => {
		const statuses = new Map<string, string | undefined>();
		const ui: StatusUI = {
			setStatus: (key, text) => statuses.set(key, text),
			setWidget: () => {},
			theme: { fg: (_color, text) => text },
		};
		const status = new StatusController();
		status.attach(ui);
		status.setWorkerCost(1.25);
		expect(statuses.get("om")).toContain("$1.2500");
	});
});
