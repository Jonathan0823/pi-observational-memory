import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function sessionMemoryDir(cwd: string, sessionId: string): string {
	return join(cwd, ".memory", sessionId);
}

function readHeader(path: string): { id?: string; parentSession?: string } | undefined {
	try {
		const firstLine = readFileSync(path, "utf-8").split("\n", 1)[0];
		const header = JSON.parse(firstLine) as { type?: string; id?: string; parentSession?: string };
		return header.type === "session" && typeof header.id === "string" ? header : undefined;
	} catch { return undefined; }
}

function copyMemory(source: string, target: string): void {
	mkdirSync(target, { recursive: true });
	for (const name of readdirSync(source)) {
		if (name === ".runs") continue;
		const from = join(source, name), to = join(target, name);
		if (statSync(from).isDirectory()) copyMemory(from, to);
		else copyFileSync(from, to);
	}
}

/** Resolve and initialize one immutable session root. A fork is seeded only on its first touch. */
export function ensureSessionMemoryRoot(cwd: string, sessionId: string, sessionFile?: string): string | undefined {
	const root = resolve(sessionMemoryDir(cwd, sessionId));
	if (existsSync(root)) return root;
	const header = sessionFile ? readHeader(sessionFile) : undefined;
	if (header?.id !== sessionId) return undefined;
	if (header.parentSession) {
		const parentHeader = readHeader(header.parentSession);
		if (!parentHeader) return undefined;
		const parentRoot = sessionMemoryDir(cwd, parentHeader.id!);
		if (!existsSync(parentRoot)) return undefined;
		copyMemory(parentRoot, root);
	} else {
		mkdirSync(root, { recursive: true });
	}
	return root;
}
