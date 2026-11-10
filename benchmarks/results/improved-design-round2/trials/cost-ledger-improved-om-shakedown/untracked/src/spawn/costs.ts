import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { OM_WORKER_COST } from "../ledger/types.js";
import { readWorkerCost, workerCostPath } from "./runs.js";

/** Import the worker's cumulative cost into the parent session, even after a failed run. */
export function recordWorkerCost(
	pi: Pick<ExtensionAPI, "appendEntry">,
	cwd: string,
	role: "observer" | "consolidator",
	runId: string,
): number | undefined {
	const cost = readWorkerCost(workerCostPath(cwd, runId), role, runId);
	if (cost === undefined) return undefined;
	pi.appendEntry(OM_WORKER_COST, { role, runId, cost });
	return cost;
}
