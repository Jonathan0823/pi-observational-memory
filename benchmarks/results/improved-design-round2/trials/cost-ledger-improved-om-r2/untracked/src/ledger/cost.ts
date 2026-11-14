import { isWorkerCostEntry, type Entry } from "./types.js";

/** Sum valid worker usage costs across the supplied complete session entry list. */
export function totalWorkerCost(entries: Entry[]): number {
	let total = 0;
	for (const entry of entries) {
		if (!isWorkerCostEntry(entry)) continue;
		const next = total + entry.data.cost;
		if (Number.isFinite(next)) total = next;
	}
	return total;
}
