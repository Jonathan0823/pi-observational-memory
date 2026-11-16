import { existsSync } from "node:fs";
import { join } from "node:path";
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

export type BenchmarkLookupPolicy = "unchanged" | "guided" | "mandatory";

export function registerBenchmarkLookupPolicy(pi: ExtensionAPI, policy: BenchmarkLookupPolicy): void {
	if (policy === "unchanged") return;
	const guidance = policy === "guided"
		? "When earlier decisions or constraints matter, consult a relevant observational-memory topic. Expand its exact source only when the topic is incomplete, uncertain, or conflicts with current evidence. Do not perform unnecessary lookups."
		: "Before each declared delayed probe, read a relevant observational-memory topic if one exists. Expand source history only when the topic is incomplete, uncertain, or conflicts with current evidence. Do not invent a topic when none exists.";
	pi.on("before_agent_start" as never, ((event: { systemPrompt?: string }, ctx: { cwd?: string }) => {
		if (policy === "mandatory" && (!ctx.cwd || !existsSync(join(ctx.cwd, ".pi", "benchmark-probe-active")))) {
			return undefined;
		}
		return { systemPrompt: `${event.systemPrompt ?? ""}\n\n${guidance}` };
	}) as never);
}

/** Load this instead of `src/index.ts` only in an isolated benchmark run. */
export default function observationalMemoryBenchmark(pi: ExtensionAPI): void {
	registerBenchmarkMemoryGate(pi);
	const policy = process.env.PI_BENCHMARK_MEMORY_POLICY ?? "unchanged";
	if (policy === "guided" || policy === "mandatory" || policy === "unchanged") {
		registerBenchmarkLookupPolicy(pi, policy);
	}
	observationalMemory(process.env.PI_BENCHMARK_MEMORY_DIAGNOSTICS === "1" ? instrumentProductionHooks(pi) : pi);
}
