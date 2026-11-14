import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexPath, listTopics, atomicWrite } from "../src/memory/paths.js";
import { sessionMemoryRoot } from "../src/memory/session-root.js";
import { runResultPath, runsDir } from "../src/spawn/runs.js";

const tempDirs: string[] = [];
function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "om-session-memory-"));
	tempDirs.push(dir);
	return dir;
}
afterEach(() => { for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function headerFile(dir: string, name: string, id: string, parentSession?: string): string {
	const path = join(dir, name);
	writeFileSync(path, JSON.stringify({ type: "session", id, cwd: dir, parentSession }) + "\n", "utf-8");
	return path;
}

describe("per-session durable memory", () => {
	it("isolates memory roots by immutable session ID", () => {
		const cwd = tempDir();
		atomicWrite(indexPath(cwd, "session-a"), "A");
		atomicWrite(indexPath(cwd, "session-b"), "B");
		expect(readFileSync(indexPath(cwd, "session-a"), "utf-8")).toBe("A");
		expect(readFileSync(indexPath(cwd, "session-b"), "utf-8")).toBe("B");
	});

	it("seeds a fork from the parent once, excluding transient runs", () => {
		const cwd = tempDir();
		const parent = headerFile(cwd, "parent.jsonl", "immutable-parent-id");
		const child = { id: "immutable-child-id", parentSession: parent };
		const parentRoot = join(cwd, ".memory", "immutable-parent-id");
		mkdirSync(join(parentRoot, ".runs"), { recursive: true });
		writeFileSync(join(parentRoot, "topic.md"), "parent topic");
		writeFileSync(join(parentRoot, ".runs", "ipc.json"), "transient");
		const childRoot = sessionMemoryRoot(cwd, child)!;
		expect(readFileSync(join(childRoot, "topic.md"), "utf-8")).toBe("parent topic");
		expect(existsSync(join(childRoot, ".runs"))).toBe(false);
		writeFileSync(join(parentRoot, "topic.md"), "changed parent");
		expect(sessionMemoryRoot(cwd, child)).toBe(childRoot);
		expect(readFileSync(join(childRoot, "topic.md"), "utf-8")).toBe("parent topic");
	});

	it("does not create the child root if the parent header or memory is unavailable", () => {
		const cwd = tempDir();
		const missingHeader = { id: "child-a", parentSession: join(cwd, "missing.jsonl") };
		const missingRoot = sessionMemoryRoot(cwd, missingHeader)!;
		expect(existsSync(missingRoot)).toBe(false);
		const parent = headerFile(cwd, "parent.jsonl", "parent-id");
		const child = { id: "child-b", parentSession: parent };
		const deferredRoot = sessionMemoryRoot(cwd, child)!;
		expect(existsSync(deferredRoot)).toBe(false);
		atomicWrite(indexPath(cwd, child.id), "first durable write");
		expect(readFileSync(indexPath(cwd, child.id), "utf-8")).toBe("first durable write");
	});

	it("derives parent root from the header ID, not its filename", () => {
		const cwd = tempDir();
		const parent = headerFile(cwd, "file-name-is-not-id.jsonl", "header-parent-id");
		mkdirSync(join(cwd, ".memory", "header-parent-id"), { recursive: true });
		writeFileSync(join(cwd, ".memory", "header-parent-id", "topic.md"), "by header");
		const root = sessionMemoryRoot(cwd, { id: "child", parentSession: parent })!;
		expect(listTopics(cwd, "child").map((topic) => topic.filename)).toEqual(["topic.md"]);
		expect(readFileSync(join(root, "topic.md"), "utf-8")).toBe("by header");
	});

	it("places worker IPC under the owning root's excluded .runs directory", () => {
		const cwd = tempDir();
		expect(runsDir(cwd, "sid")).toBe(join(cwd, ".memory", "sid", ".runs"));
		expect(runResultPath(cwd, "run", "sid")).toBe(join(cwd, ".memory", "sid", ".runs", "run.result.json"));
	});
});
