import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import observationalMemory from "../../src/index.js";
import { loadConfig } from "../../src/config.js";
import { OM_ENABLED, rawTokensAfterIndex, type Entry } from "../../src/ledger/index.js";

type GateContext = {
	cwd: string;
	sessionManager: { getBranch: () => Entry[] };
};

/**
 * Register before the production extension so the benchmark gate is persisted before its
 * `session_start` handler reads the session ledger. This changes only benchmark sessions;
 * production remains default-off.
 */
export function registerBenchmarkMemoryGate(pi: ExtensionAPI): void {
	pi.on("session_start", (_event: unknown, ctx: GateContext) => {
		const gate = [...ctx.sessionManager.getBranch()]
			.reverse()
			.find((entry) => entry.type === "custom" && entry.customType === OM_ENABLED);
		if ((gate?.data as { enabled?: boolean } | undefined)?.enabled === true) return;
		pi.appendEntry(OM_ENABLED, { enabled: true });
	});

	if (process.env.PI_BENCHMARK_MEMORY_DIAGNOSTICS === "1") {
		// Opt-in diagnostics distinguish a missed trigger from a trigger that never fired.
		pi.on("agent_start", (_event: unknown, ctx: GateContext) => {
			const branch = ctx.sessionManager.getBranch();
			pi.appendEntry("om.benchmark.progress", {
				rawHistoryTokens: rawTokensAfterIndex(branch, -1),
				chunkTokens: loadConfig(ctx.cwd).chunkTokens,
				sourceEntries: branch.filter((entry) => ["message", "custom_message", "branch_summary"].includes(entry.type)).length,
			});
		});
	}
}

/** Add hook telemetry only around the production extension's registered clocks. */
function instrumentProductionHooks(pi: ExtensionAPI): ExtensionAPI {
	return new Proxy(pi, {
		get(target, property) {
			if (property === "on") {
				return (event: string, handler: (...args: any[]) => unknown) => {
					const register = target.on.bind(target);
					if (event !== "agent_start" && event !== "turn_end") return register(event as never, handler as never);
					const wrapped = (payload: unknown, ctx: GateContext) => {
						const branch = ctx.sessionManager.getBranch();
						pi.appendEntry("om.benchmark.trigger-hook", {
							event,
							rawHistoryTokens: rawTokensAfterIndex(branch, -1),
							chunkTokens: loadConfig(ctx.cwd).chunkTokens,
							observerConcurrency: loadConfig(ctx.cwd).observerConcurrency,
							passive: loadConfig(ctx.cwd).passive,
							handler: handler.toString().slice(0, 160),
							gateEnabled: [...branch].reverse().find((entry) => entry.type === "custom" && entry.customType === OM_ENABLED)?.data,
						});
						return handler(payload, ctx);
					};
					return register(event as never, wrapped as never);
				};
			}
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
		}) as ExtensionAPI;
}

/** Load this instead of `src/index.ts` only in an isolated benchmark run. */
export default function observationalMemoryBenchmark(pi: ExtensionAPI): void {
	registerBenchmarkMemoryGate(pi);
	observationalMemory(process.env.PI_BENCHMARK_MEMORY_DIAGNOSTICS === "1" ? instrumentProductionHooks(pi) : pi);
}
