import { OM_WORKER_COST, type Entry } from "./types.js";

export type WorkerRole = "observer" | "consolidator";
export type WorkerCost = { role: WorkerRole; runId: string; cost: number };

export function isWorkerCost(value: unknown): value is WorkerCost {
	if (!value || typeof value !== "object") return false;
	const data = value as Record<string, unknown>;
	return (
		(data.role === "observer" || data.role === "consolidator") &&
		typeof data.runId === "string" && data.runId.length > 0 &&
		typeof data.cost === "number" && Number.isFinite(data.cost) && data.cost >= 0
	);
}

/** Return valid costs from all branches in the session's append-only entry collection. */
export function workerCosts(entries: Entry[]): WorkerCost[] {
	const costs: WorkerCost[] = [];
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== OM_WORKER_COST || !isWorkerCost(entry.data)) continue;
		costs.push(entry.data);
	}
	return costs;
}

export function totalWorkerCost(entries: Entry[]): number {
	return workerCosts(entries).reduce((total, entry) => total + entry.cost, 0);
}

export function formatWorkerCost(cost: number): string {
	return `$${cost.toFixed(4)}`;
}
