import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerBenchmarkLookupPolicy, registerBenchmarkMemoryGate } from "../benchmarks/extensions/observational-memory.js";
import { BENCHMARK_REQUEST_PACED, registerBenchmarkRequestPacer } from "../benchmarks/extensions/request-pacer.js";
import { OM_ENABLED } from "../src/ledger/types.js";

type Handler = (event: any, ctx: any) => unknown;

function fakeApi() {
	const handlers = new Map<string, Handler[]>();
	const appended: Array<{ type: string; data: unknown }> = [];
	const sent: unknown[] = [];
	const pi = {
		on(event: string, handler: Handler) {
			const registered = handlers.get(event) ?? [];
			registered.push(handler);
			handlers.set(event, registered);
		},
		appendEntry(type: string, data: unknown) {
			appended.push({ type, data });
		},
		sendMessage(message: unknown, options: unknown) {
			sent.push({ message, options });
		},
	};
	return { pi: pi as any, handlers, appended, sent };
}

describe("benchmark-only extension setup", () => {
	it("adds no guidance for the unchanged policy", () => {
		const { pi, handlers } = fakeApi();
		registerBenchmarkLookupPolicy(pi, "unchanged");
		expect(handlers.has("before_agent_start")).toBe(false);
	});

	it("adds conditional lookup guidance only for the guided policy", () => {
		const { pi, handlers } = fakeApi();
		registerBenchmarkLookupPolicy(pi, "guided");
		const result = handlers.get("before_agent_start")![0]({ systemPrompt: "base" }, {});
		expect(result).toMatchObject({ systemPrompt: expect.stringContaining("consult a relevant observational-memory topic") });
	});

	it("adds mandatory topic guidance only at a declared delayed-probe boundary", () => {
		const { pi, handlers } = fakeApi();
		registerBenchmarkLookupPolicy(pi, "mandatory");
		const beforeAgentStart = handlers.get("before_agent_start")![0];
		const cwd = mkdtempSync(join(tmpdir(), "om-probe-policy-"));
		try {
			expect(beforeAgentStart({ systemPrompt: "base" }, { cwd })).toBeUndefined();
			mkdirSync(join(cwd, ".pi"), { recursive: true });
			writeFileSync(join(cwd, ".pi", "benchmark-probe-active"), "session-id");
			const result = beforeAgentStart({ systemPrompt: "base" }, { cwd });
			expect(result).toMatchObject({
				systemPrompt: expect.stringContaining("Before each declared delayed probe"),
			});
			expect((result as any).systemPrompt).toContain("Expand source history only when the topic is incomplete");
			expect((result as any).systemPrompt).toContain("Do not invent a topic");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("enables OM by appending session state when the session is off", () => {
		const { pi, handlers, appended } = fakeApi();
		registerBenchmarkMemoryGate(pi);
		const start = handlers.get("session_start")![0];
		const ctx = { sessionManager: { getBranch: () => [] } };

		start({}, ctx);

		expect(appended).toEqual([{ type: OM_ENABLED, data: { enabled: true } }]);
	});

	it("does not append duplicate state when the session is already enabled", () => {
		const { pi, handlers, appended } = fakeApi();
		registerBenchmarkMemoryGate(pi);
		const start = handlers.get("session_start")![0];
		const ctx = {
			sessionManager: { getBranch: () => [{ type: "custom", customType: OM_ENABLED, data: { enabled: true } }] },
		};

		start({}, ctx);

		expect(appended).toHaveLength(0);
	});

	it("spaces provider requests and records only imposed benchmark delay", async () => {
		const { pi, handlers, appended } = fakeApi();
		let now = 0;
		registerBenchmarkRequestPacer(pi, {
			intervalMs: 1_000,
			now: () => now,
			sleep: async (ms) => { now += ms; },
		});
		const beforeRequest = handlers.get("before_provider_request")![0];

		await beforeRequest({}, {});
		now = 200;
		await beforeRequest({}, {});
		now = 2_000;
		await beforeRequest({}, {});

		expect(appended).toHaveLength(1);
		expect(appended[0]).toEqual({
			type: BENCHMARK_REQUEST_PACED,
			data: { delayMs: 800, role: "main", pid: expect.any(Number) },
		});
	});
});
