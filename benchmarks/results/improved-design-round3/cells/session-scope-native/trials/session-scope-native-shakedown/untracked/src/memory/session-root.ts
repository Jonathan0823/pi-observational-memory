import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { memoryDir } from "./paths.js";

type SessionIdentity = {
	getSessionId(): string;
	getHeader(): { id?: string; parentSession?: string } | undefined;
};

function readSessionHeader(sessionFile: string): { id?: string } | undefined {
	try {
		const firstLine = readFileSync(sessionFile, "utf-8").split("\n", 1)[0];
		const value = JSON.parse(firstLine) as { type?: string; id?: unknown };
		return value.type === "session" && typeof value.id === "string" ? { id: value.id } : undefined;
	} catch {
		return undefined;
	}
}

/** Resolve this session's durable root and seed it once from its fork parent, if available. */
export function sessionMemoryDir(cwd: string, session: SessionIdentity): string {
	const id = session.getSessionId();
	if (!id || id === "." || id === ".." || /[\\/]/.test(id)) throw new Error("Invalid session id");
	const childRoot = memoryDir(cwd, id);
	if (existsSync(childRoot)) return childRoot;

	const parentPath = session.getHeader()?.parentSession;
	if (!parentPath) return childRoot;
	const parentHeader = readSessionHeader(resolve(parentPath));
	if (!parentHeader?.id || parentHeader.id === "." || parentHeader.id === ".." || /[\\/]/.test(parentHeader.id)) {
		return childRoot;
	}
	const parentRoot = memoryDir(cwd, parentHeader.id);
	if (!existsSync(parentRoot)) return childRoot;

	mkdirSync(join(cwd, ".memory"), { recursive: true });
	cpSync(parentRoot, childRoot, {
		recursive: true,
		filter: (source) => source === parentRoot || !source.slice(parentRoot.length + 1).split(/[\\/]/).includes(".runs"),
	});
	return childRoot;
}
