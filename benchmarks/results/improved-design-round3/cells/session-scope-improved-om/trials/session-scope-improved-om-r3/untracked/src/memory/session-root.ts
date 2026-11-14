import { existsSync, mkdirSync, readFileSync, readdirSync, copyFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { memoryDir } from "./paths.js";

export type SessionMemoryIdentity = {
	cwd: string;
	sessionId: string;
	sessionFile?: string;
	parentSession?: string;
};

export function sessionMemoryDirFromManager(cwd: string, manager: {
	getSessionId?: () => string;
	getSessionFile?: () => string | undefined;
	getHeader?: () => { id?: string; parentSession?: string } | null;
}): string {
	const header = manager.getHeader?.();
	const sessionId = manager.getSessionId?.() ?? header?.id;
	if (!sessionId) return memoryDir(cwd);
	return sessionMemoryDir({ cwd, sessionId, sessionFile: manager.getSessionFile?.(), parentSession: header?.parentSession });
}

function copyDurableTree(source: string, destination: string): void {
	mkdirSync(destination, { recursive: true });
	for (const name of readdirSync(source)) {
		if (name === ".runs") continue;
		const from = join(source, name);
		const to = join(destination, name);
		if (statSync(from).isDirectory()) copyDurableTree(from, to);
		else copyFileSync(from, to);
	}
}

/** Resolve and initialize this session's memory root, seeding a fork only when its root is absent. */
export function sessionMemoryDir(identity: SessionMemoryIdentity): string {
	const childRoot = memoryDir(identity.cwd, identity.sessionId);
	if (existsSync(childRoot) || !identity.parentSession) return childRoot;

	try {
		const parentFile = resolve(dirname(identity.sessionFile ?? identity.cwd), identity.parentSession);
		const firstLine = readFileSync(parentFile, "utf-8").split(/\r?\n/, 1)[0];
		const header = JSON.parse(firstLine) as { type?: unknown; id?: unknown; cwd?: unknown };
		if (header.type !== "session" || typeof header.id !== "string" || typeof header.cwd !== "string") return childRoot;
		const parentRoot = memoryDir(header.cwd, header.id);
		if (!existsSync(parentRoot)) return childRoot;
		copyDurableTree(parentRoot, childRoot);
	} catch {
		// Missing/unreadable parent metadata defers initialization until a durable write.
	}
	return childRoot;
}
