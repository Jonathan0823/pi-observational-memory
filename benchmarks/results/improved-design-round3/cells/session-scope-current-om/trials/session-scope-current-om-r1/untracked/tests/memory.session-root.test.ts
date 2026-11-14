import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureSessionMemoryRoot } from "../src/memory/session-root.js";
import { listTopics, memoryDir } from "../src/memory/paths.js";
import { runResultPath, runsDir } from "../src/spawn/runs.js";

const dirs: string[] = [];
function temp(): string { const dir = mkdtempSync(join(tmpdir(), "om-session-memory-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("per-session durable roots", () => {
	it("isolates topics by immutable session ID and seeds from the parent header ID", () => {
		const cwd = temp();
		const parentId = "parent-uuid";
		const childId = "child-uuid";
		const parentRoot = memoryDir(cwd, parentId);
		mkdirSync(parentRoot, { recursive: true });
		writeFileSync(join(parentRoot, "topic.md"), "parent content");
		writeFileSync(join(cwd, "parent-session.jsonl"), JSON.stringify({ type: "session", id: parentId, cwd }) + "\n");
		const childRoot = ensureSessionMemoryRoot(cwd, childId, "parent-session.jsonl");
		expect(readFileSync(join(childRoot, "topic.md"), "utf8")).toBe("parent content");
		expect(listTopics(cwd, parentId)).toHaveLength(1);
		expect(listTopics(cwd, childId)).toHaveLength(1);
	});

	it("leaves the child root absent when parent memory is missing and permits later durable writes", () => {
		const cwd = temp();
		writeFileSync(join(cwd, "parent.jsonl"), JSON.stringify({ type: "session", id: "parent" }) + "\n");
		const root = ensureSessionMemoryRoot(cwd, "child", "parent.jsonl");
		expect(existsSync(root)).toBe(false);
		mkdirSync(root, { recursive: true });
		writeFileSync(join(root, "later.md"), "written");
		expect(readFileSync(join(root, "later.md"), "utf8")).toBe("written");
	});

	it("does not overwrite existing child memory on resume", () => {
		const cwd = temp();
		mkdirSync(memoryDir(cwd, "parent"), { recursive: true });
		writeFileSync(join(memoryDir(cwd, "parent"), "topic.md"), "new parent");
		writeFileSync(join(cwd, "parent.jsonl"), JSON.stringify({ type: "session", id: "parent" }) + "\n");
		mkdirSync(memoryDir(cwd, "child"), { recursive: true });
		writeFileSync(join(memoryDir(cwd, "child"), "topic.md"), "child version");
		ensureSessionMemoryRoot(cwd, "child", "parent.jsonl");
		expect(readFileSync(join(memoryDir(cwd, "child"), "topic.md"), "utf8")).toBe("child version");
	});

	it("excludes transient runs when seeding and scopes worker IPC to the session", () => {
		const cwd = temp();
		const parent = memoryDir(cwd, "parent");
		mkdirSync(join(parent, ".runs"), { recursive: true });
		writeFileSync(join(parent, ".runs", "old.json"), "transient");
		writeFileSync(join(parent, "topic.md"), "durable");
		writeFileSync(join(cwd, "parent.jsonl"), JSON.stringify({ type: "session", id: "parent" }) + "\n");
		const child = ensureSessionMemoryRoot(cwd, "child", "parent.jsonl");
		expect(existsSync(join(child, ".runs"))).toBe(false);
		expect(runsDir(cwd, "child")).toBe(join(child, ".runs"));
		expect(runResultPath(cwd, "run", "child")).toBe(join(child, ".runs", "run.result.json"));
	});
});
