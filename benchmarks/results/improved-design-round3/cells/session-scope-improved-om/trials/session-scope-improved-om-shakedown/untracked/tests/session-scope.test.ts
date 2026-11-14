import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { memoryDir } from "../src/memory/paths.js";
import { seedForkMemory, sessionMemoryDir } from "../src/memory/session-scope.js";
import { runResultPath } from "../src/spawn/runs.js";

let cwd: string;
beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "om-session-scope-")); });
afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

function header(path: string, id: string, parentSession?: string): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ type: "session", id, cwd, ...(parentSession ? { parentSession } : {}) })}\n`, "utf-8");
}

describe("per-session durable memory roots", () => {
	it("isolates session memory and worker IPC paths", () => {
		expect(memoryDir(cwd, "session-a")).toBe(join(cwd, ".memory", "session-a"));
		expect(memoryDir(cwd, "session-b")).not.toBe(memoryDir(cwd, "session-a"));
		expect(runResultPath(cwd, "run", "session-a")).toBe(join(cwd, ".memory", "session-a", ".runs", "run.result.json"));
	});

	it("seeds a fork once from the parent's header id, excluding transient runs", () => {
		const parentFile = join(cwd, "sessions", "parent.jsonl");
		const childFile = join(cwd, "sessions", "child.jsonl");
		header(parentFile, "parent-id");
		header(childFile, "child-id", parentFile);
		const parentRoot = sessionMemoryDir(cwd, "parent-id");
		mkdirSync(join(parentRoot, ".runs"), { recursive: true });
		mkdirSync(join(parentRoot, "nested"), { recursive: true });
		writeFileSync(join(parentRoot, "topic.md"), "parent durable data");
		writeFileSync(join(parentRoot, "nested", "note.md"), "nested durable data");
		writeFileSync(join(parentRoot, ".runs", "ipc.json"), "transient");

		seedForkMemory(cwd, "child-id", childFile);
		const childRoot = sessionMemoryDir(cwd, "child-id");
		expect(readFileSync(join(childRoot, "topic.md"), "utf-8")).toBe("parent durable data");
		expect(readFileSync(join(childRoot, "nested", "note.md"), "utf-8")).toBe("nested durable data");
		expect(existsSync(join(childRoot, ".runs"))).toBe(false);

		writeFileSync(join(childRoot, "topic.md"), "child changes");
		seedForkMemory(cwd, "child-id", childFile);
		expect(readFileSync(join(childRoot, "topic.md"), "utf-8")).toBe("child changes");
	});

	it("leaves the child root absent when parent metadata or memory is unavailable", () => {
		const childFile = join(cwd, "sessions", "child.jsonl");
		header(childFile, "child-id", join(cwd, "sessions", "missing-parent.jsonl"));
		seedForkMemory(cwd, "child-id", childFile);
		expect(existsSync(sessionMemoryDir(cwd, "child-id"))).toBe(false);

		const parentFile = join(cwd, "sessions", "parent.jsonl");
		header(parentFile, "parent-id");
		header(childFile, "child-id", parentFile);
		seedForkMemory(cwd, "child-id", childFile);
		expect(existsSync(sessionMemoryDir(cwd, "child-id"))).toBe(false);
	});
});
