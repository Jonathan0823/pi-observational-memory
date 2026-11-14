import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureSessionMemoryRoot, sessionMemoryDir } from "../src/memory/session-root.js";

let dirs: string[] = [];
function temp(): string { const d = mkdtempSync(join(tmpdir(), "om-session-mem-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs = []; });
function header(file: string, id: string, parentSession?: string): void {
	writeFileSync(file, `${JSON.stringify({ type: "session", id, parentSession })}\n`);
}

describe("session memory roots", () => {
	it("isolates sessions and seeds from a parent once, excluding .runs", () => {
		const cwd = temp(), parentFile = join(cwd, "parent.jsonl"), childFile = join(cwd, "child.jsonl");
		header(parentFile, "parent-id"); header(childFile, "child-id", parentFile);
		const parent = sessionMemoryDir(cwd, "parent-id");
		mkdirSync(join(parent, ".runs"), { recursive: true });
		writeFileSync(join(parent, "auth.md"), "parent content");
		writeFileSync(join(parent, ".runs", "ipc.json"), "transient");
		const child = ensureSessionMemoryRoot(cwd, "child-id", childFile)!;
		expect(readFileSync(join(child, "auth.md"), "utf-8")).toBe("parent content");
		expect(existsSync(join(child, ".runs"))).toBe(false);
		writeFileSync(join(child, "auth.md"), "child update");
		expect(readFileSync(join(parent, "auth.md"), "utf-8")).toBe("parent content");
		writeFileSync(join(parent, "later.md"), "new parent data");
		expect(ensureSessionMemoryRoot(cwd, "child-id", childFile)).toBe(child);
		expect(exists(child, "later.md")).toBe(false);
	});
	it("leaves the child root uncreated when parent session or memory is unavailable", () => {
		const cwd = temp(), childFile = join(cwd, "child.jsonl");
		header(childFile, "child", join(cwd, "missing-parent.jsonl"));
		expect(ensureSessionMemoryRoot(cwd, "child", childFile)).toBeUndefined();
		expect(existsSync(sessionMemoryDir(cwd, "child"))).toBe(false);
		const parentFile = join(cwd, "parent.jsonl"); header(parentFile, "parent");
		header(childFile, "child", parentFile);
		expect(ensureSessionMemoryRoot(cwd, "child", childFile)).toBeUndefined();
	});
	it("does not initialize from a mismatched child header", () => {
		const cwd = temp(), file = join(cwd, "s.jsonl"); header(file, "other");
		expect(ensureSessionMemoryRoot(cwd, "wanted", file)).toBeUndefined();
	});
});
function exists(root: string, name: string): boolean {
	try { readFileSync(join(root, name)); return true; } catch { return false; }
}
