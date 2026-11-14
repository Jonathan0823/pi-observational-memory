import { cpSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** Resolve the durable root belonging to one immutable pi session id. */
export function sessionMemoryDir(cwd: string, sessionId: string): string {
	if (!sessionId || sessionId === "." || sessionId === ".." || /[\\/\\0]/.test(sessionId)) {
		throw new Error("Invalid session id for observational memory");
	}
	return join(resolve(cwd), ".memory", sessionId);
}

function readHeader(sessionFile: string): { id?: unknown; parentSession?: unknown } | undefined {
	try {
		const firstLine = readFileSync(sessionFile, "utf-8").split(/\r?\n/, 1)[0];
		const header: unknown = JSON.parse(firstLine);
		if (!header || typeof header !== "object" || (header as { type?: unknown }).type !== "session") return undefined;
		return header as { id?: unknown; parentSession?: unknown };
	} catch {
		return undefined;
	}
}

/**
 * Seed a fork's durable memory once. Existing child data is authoritative; missing/unreadable
 * parent metadata or memory leaves the child root absent until its first durable write.
 */
export function seedForkMemory(cwd: string, sessionId: string, childSessionFile: string | undefined): void {
	if (!childSessionFile) return;
	const childRoot = sessionMemoryDir(cwd, sessionId);
	if (existsSync(childRoot)) return;
	const childHeader = readHeader(childSessionFile);
	if (typeof childHeader?.parentSession !== "string" || !childHeader.parentSession) return;
	const parentSessionFile = isAbsolute(childHeader.parentSession)
		? childHeader.parentSession
		: resolve(dirname(childSessionFile), childHeader.parentSession);
	const parentHeader = readHeader(parentSessionFile);
	if (typeof parentHeader?.id !== "string" || !parentHeader.id) return;
	const parentRoot = sessionMemoryDir(cwd, parentHeader.id);
	if (!existsSync(parentRoot) || !statSync(parentRoot).isDirectory()) return;
	mkdirSync(dirname(childRoot), { recursive: true });
	cpSync(parentRoot, childRoot, {
		recursive: true,
		filter: (source) => source === parentRoot || source.split(/[\\/]/).at(-1) !== ".runs",
	});
}
