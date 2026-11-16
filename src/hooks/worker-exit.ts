import type { WorkerExit } from "../spawn/launch.js";

export function throwIfWorkerFailed(role: "observer" | "consolidator", exit: WorkerExit): void {
	if (exit.code === 0) return;
	const detail = exit.stderr ? `: ${exit.stderr.trim().slice(0, 200)}` : "";
	throw new Error(`${role} exited with code ${exit.code}${detail}`);
}
