import { OM_WORKER_COST, type Entry } from "./types.js";

/** Parse a cost value without allowing malformed or invalid ledger data to affect totals. */
export function validWorkerCost(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Sum every valid worker cost in the append-only session ledger, including abandoned branches. */
export function totalWorkerCost(entries: Entry[]): number {
	let total = 0;
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== OM_WORKER_COST) continue;
		const data = entry.data;
		if (!data || typeof data !== "object") continue;
		const cost = (data as { cost?: unknown }).cost;
		if (validWorkerCost(cost)) total += cost;
	}
	return total;
}

export function buildWorkerCostData(role: unknown, runId: unknown, cost: unknown) {
	if ((role !== "observer" && role !== "consolidator") || typeof runId !== "string" || !runId || !validWorkerCost(cost)) {
		return undefined;
	}
	return { role, runId, cost } as const;
}
