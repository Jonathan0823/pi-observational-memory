import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listTopics } from "../src/memory/paths.js";
import { sessionMemoryDir } from "../src/memory/session-root.js";

const dirs: string[] = [];
function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "om-session-memory-"));
	dirs.push(dir);
	return dir;
}
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function session(id: string, parentSession?: string) {
	return { getSessionId: () => id, getHeader: () => ({ type: "session", id, parentSession }) };
}
function header(path: string, id: string): void {
	writeFileSync(path, `${JSON.stringify({ type: "session", id })}\n`, "utf-8");
}

describe("sessionMemoryDir", () => {
	it("isolates session roots and seeds a fork from the parent's immutable header id", () => {
		const cwd = tempDir();
		const parentPath = join(cwd, "parent.jsonl");
		const parentRoot = join(cwd, ".memory", "parent-header-id");
		header(parentPath, "parent-header-id");
		mkdirSync(join(parentRoot, "nested"), { recursive: true });
		writeFileSync(join(parentRoot, "topic.md"), "parent topic");
		writeFileSync(join(parentRoot, "nested", "note.md"), "nested note");
		mkdirSync(join(parentRoot, ".runs"));
		writeFileSync(join(parentRoot, ".runs", "transient.json"), "transient");

		const child = session("child-header-id", parentPath);
		const childRoot = sessionMemoryDir(cwd, child);
		expect(childRoot).toBe(join(cwd, ".memory", "child-header-id"));
		expect(readFileSync(join(childRoot, "topic.md"), "utf-8")).toBe("parent topic");
		expect(readFileSync(join(childRoot, "nested", "note.md"), "utf-8")).toBe("nested note");
		expect(existsSync(join(childRoot, ".runs"))).toBe(false);
		expect(sessionMemoryDir(cwd, session("another-session"))).not.toBe(childRoot);
		expect(listTopics(cwd, "child-header-id").map((topic) => topic.filename)).toEqual(["topic.md"]);
		expect(listTopics(cwd, "another-session")).toEqual([]);
	});

	it("leaves the child root uncreated when parent header or parent memory is unavailable", () => {
		const cwd = tempDir();
		const unreadablePath = join(cwd, "missing.jsonl");
		const missingParentRoot = sessionMemoryDir(cwd, session("child-a", unreadablePath));
		expect(existsSync(missingParentRoot)).toBe(false);

		const parentPath = join(cwd, "parent.jsonl");
		header(parentPath, "parent-without-memory");
		const root = sessionMemoryDir(cwd, session("child-b", parentPath));
		expect(existsSync(root)).toBe(false);
	});

	it("never re-seeds an existing child root on resume", () => {
		const cwd = tempDir();
		const parentPath = join(cwd, "parent.jsonl");
		header(parentPath, "parent");
		const parentRoot = join(cwd, ".memory", "parent");
		mkdirSync(parentRoot, { recursive: true });
		writeFileSync(join(parentRoot, "topic.md"), "original");
		const childRoot = sessionMemoryDir(cwd, session("child", parentPath));
		writeFileSync(join(childRoot, "topic.md"), "child edit");
		writeFileSync(join(parentRoot, "later.md"), "new parent content");

		expect(sessionMemoryDir(cwd, session("child", parentPath))).toBe(childRoot);
		expect(readFileSync(join(childRoot, "topic.md"), "utf-8")).toBe("child edit");
		expect(existsSync(join(childRoot, "later.md"))).toBe(false);
	});
});
