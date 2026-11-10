import { OM_WORKER_COST, type Entry } from "./types.js";

export type WorkerRole = "observer" | "consolidator";
export type WorkerCostData = { runId: string; role: WorkerRole; cost: number };

export function isValidWorkerCost(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function isWorkerCostData(value: unknown): value is WorkerCostData {
	if (!value || typeof value !== "object") return false;
	const data = value as Record<string, unknown>;
	return (
		typeof data.runId === "string" &&
		(data.role === "observer" || data.role === "consolidator") &&
		isValidWorkerCost(data.cost)
	);
}

/** Sum valid worker costs from the supplied full session entry set (including off-branch entries). */
export function totalWorkerCost(entries: readonly Entry[]): number {
	let total = 0;
	for (const entry of entries) {
		if (entry.type === "custom" && entry.customType === OM_WORKER_COST && isWorkerCostData(entry.data)) {
			const next = total + entry.data.cost;
			if (Number.isFinite(next)) total = next;
		}
	}
	return total;
}
