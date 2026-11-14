import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { memoryDir } from "./paths.js";

export function sessionMemoryDir(cwd: string, sessionId: string): string {
	if (!sessionId || sessionId === "." || sessionId === ".." || /[\\/]/.test(sessionId)) throw new Error("invalid session id");
	return memoryDir(cwd, sessionId);
}

/** Seed a fork's immutable session root once. Missing/unreadable parent data is a no-op. */
export function ensureSessionMemoryRoot(cwd: string, sessionId: string, parentSession?: string): string {
	const child = sessionMemoryDir(cwd, sessionId);
	if (existsSync(child) || !parentSession) return child;
	try {
		const parentFile = isAbsolute(parentSession) ? parentSession : resolve(cwd, parentSession);
		const firstLine = readFileSync(parentFile, "utf8").split("\n", 1)[0];
		const header = JSON.parse(firstLine) as { type?: string; id?: string };
		if (header.type !== "session" || !header.id || header.id === sessionId) return child;
		const source = sessionMemoryDir(cwd, header.id);
		if (!existsSync(source) || !statSync(source).isDirectory()) return child;
		mkdirSync(child, { recursive: true });
		for (const name of readdirSync(source)) {
			if (name === ".runs" || name.startsWith(".")) continue;
			const from = join(source, name);
			if (statSync(from).isDirectory()) cpSync(from, join(child, name), { recursive: true, errorOnExist: true });
			else cpSync(from, join(child, name), { errorOnExist: true });
		}
	} catch {
		// No child directory is made for an unreadable parent; writes can create it later.
	}
	return child;
}
