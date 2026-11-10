import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { OM_WORKER_COST } from "../ledger/types.js";
import { readWorkerCost } from "./runs.js";

export type WorkerRole = "observer" | "consolidator";

/** Commit a worker's provider-reported cost even when its result was ephemeral or failed. */
export function recordWorkerCost(pi: ExtensionAPI, path: string, role: WorkerRole, runId: string): void {
	const result = readWorkerCost(path);
	if (result) pi.appendEntry(OM_WORKER_COST, { cost: result.cost, role, runId });
}

/** Sum valid cost entries from the supplied session entries, including entries on other branches. */
export function totalWorkerCost(entries: Array<{ customType?: string; data?: unknown }>): number {
	let total = 0;
	for (const entry of entries) {
		if (entry.customType !== OM_WORKER_COST || !entry.data || typeof entry.data !== "object") continue;
		const cost = (entry.data as { cost?: unknown }).cost;
		if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) total += cost;
	}
	return total;
}
