import { describe, expect, it } from "vitest";
import { registerBenchmarkMemoryGate } from "../benchmarks/extensions/observational-memory.js";
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
