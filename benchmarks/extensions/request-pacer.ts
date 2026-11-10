import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const BENCHMARK_REQUEST_PACED = "benchmark.request_paced";

export type RequestPacerOptions = {
	intervalMs: number;
	logDir?: string;
	role?: string;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function registerBenchmarkRequestPacer(pi: ExtensionAPI, options: RequestPacerOptions): void {
	const now = options.now ?? Date.now;
	const sleep = options.sleep ?? defaultSleep;
	let lastRequestAt: number | undefined;

	pi.on("before_provider_request", async () => {
		const beforeWait = now();
		const delayMs = lastRequestAt === undefined ? 0 : Math.max(0, options.intervalMs - (beforeWait - lastRequestAt));
		if (delayMs > 0) await sleep(delayMs);
		lastRequestAt = now();
		if (delayMs > 0) {
			const record = { delayMs, role: options.role ?? process.env.OM_WORKER ?? "main", pid: process.pid };
			pi.appendEntry(BENCHMARK_REQUEST_PACED, record);
			if (options.logDir) {
				try {
					mkdirSync(options.logDir, { recursive: true });
					appendFileSync(join(options.logDir, `request-pacing-${process.pid}.jsonl`), `${JSON.stringify(record)}\n`);
				} catch {
					// Measurement logging must never affect a benchmark request.
				}
			}
		}
	});
}

export default function (pi: ExtensionAPI): void {
	const intervalMs = Number.parseInt(process.env.PI_BENCHMARK_REQUEST_INTERVAL_MS ?? "15000", 10);
	registerBenchmarkRequestPacer(pi, {
		intervalMs: Number.isFinite(intervalMs) ? intervalMs : 15000,
		logDir: process.env.PI_BENCHMARK_PACING_DIR,
		role: process.env.OM_WORKER ?? "main",
	});
}
