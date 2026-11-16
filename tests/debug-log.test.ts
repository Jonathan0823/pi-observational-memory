import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { debugLog, withDebugLogContext } from "../src/debug-log.js";

let agentDir: string;
let previousAgentDir: string | undefined;

afterEach(() => {
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	if (agentDir) rmSync(agentDir, { recursive: true, force: true });
});

describe("session-scoped lifecycle diagnostics", () => {
	it("writes versioned events only when opted in, without conversation content", () => {
		agentDir = mkdtempSync(join(tmpdir(), "om-debug-log-"));
		previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;

		withDebugLogContext({ enabled: false, cwd: "/tmp/project", sessionId: "session-1" }, () => {
			debugLog("observer.completed", { observationCount: 2 });
		});
		const path = join(agentDir, "observational-memory", "debug", "session-1.ndjson");
		expect(existsSync(path)).toBe(false);

		withDebugLogContext({ enabled: true, cwd: "/tmp/project", sessionId: "session-1" }, () => {
			debugLog("observer.completed", { observationCount: 2, sourceRange: { firstEntryId: "e1", lastEntryId: "e2" } });
		});
		const event = JSON.parse(readFileSync(path, "utf-8"));
		expect(event).toMatchObject({
			schemaVersion: 1,
			event: "observer.completed",
			cwd: "/tmp/project",
			sessionId: "session-1",
			data: { observationCount: 2, sourceRange: { firstEntryId: "e1", lastEntryId: "e2" } },
		});
		expect(readFileSync(path, "utf-8")).not.toContain("conversation text");
	});
});
