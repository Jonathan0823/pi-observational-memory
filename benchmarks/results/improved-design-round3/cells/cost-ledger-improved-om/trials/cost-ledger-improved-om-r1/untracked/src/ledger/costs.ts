import type { Entry } from "./types.js";
import { readWorkerUsage, usageResultPath } from "../spawn/runs.js";

export const OM_WORKER_COST = "om.worker.cost";

export type WorkerRole = "observer" | "consolidator";
export type WorkerCostEntryData = { role: WorkerRole; runId: string; cost: number };

export function isWorkerCostEntry(entry: Entry): entry is Entry & { data: WorkerCostEntryData } {
	if (entry.type !== "custom" || entry.customType !== OM_WORKER_COST || !entry.data || typeof entry.data !== "object") return false;
	const data = entry.data as Record<string, unknown>;
	return (
		(data.role === "observer" || data.role === "consolidator") &&
		typeof data.runId === "string" && data.runId.length > 0 &&
		typeof data.cost === "number" && Number.isFinite(data.cost) && data.cost >= 0
	);
}

export function recordWorkerCost(
	appendEntry: (customType: string, data: WorkerCostEntryData) => void,
	cwd: string,
	role: WorkerRole,
	runId: string,
): number | undefined {
	const usage = readWorkerUsage(usageResultPath(cwd, runId));
	if (!usage) return undefined;
	appendEntry(OM_WORKER_COST, { role, runId, cost: usage.cost });
	return usage.cost;
}

/** Sum valid worker costs across every session entry, including abandoned branches. */
export function totalWorkerCost(entries: Entry[]): number {
	return entries.reduce((total, entry) => total + (isWorkerCostEntry(entry) ? entry.data.cost : 0), 0);
}
