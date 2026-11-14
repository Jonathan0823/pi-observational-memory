import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function sessionIdFromManager(manager: { getHeader?: () => { id?: string } | null }): string {
	const id = manager.getHeader?.()?.id;
	if (!id) throw new Error("Cannot resolve durable memory without a session header ID");
	return id;
}

/** Read the immutable identity/parent link from a pi session file's first-line header. */
export function readSessionHeader(sessionFile: string): { id: string; parentSession?: string } | undefined {
	try {
		const firstLine = readFileSync(sessionFile, "utf-8").split(/\r?\n/, 1)[0];
		const value = JSON.parse(firstLine) as { type?: unknown; id?: unknown; parentSession?: unknown };
		if (value.type !== "session" || typeof value.id !== "string" || !value.id) return undefined;
		return { id: value.id, ...(typeof value.parentSession === "string" ? { parentSession: value.parentSession } : {}) };
	} catch {
		return undefined;
	}
}

/** Seed an absent session root once from its parent. Existing roots are never modified. */
export function seedSessionMemory(cwd: string, sessionId: string, sessionFile?: string): string {
	const root = join(cwd, ".memory", sessionId);
	if (existsSync(root) || !sessionFile) return root;
	const child = readSessionHeader(sessionFile);
	if (!child?.parentSession) return root;
	const parentPath = resolve(dirname(sessionFile), child.parentSession);
	const parentHeader = readSessionHeader(parentPath);
	if (!parentHeader) return root;
	const parentRoot = join(cwd, ".memory", parentHeader.id);
	if (!existsSync(parentRoot) || !statSync(parentRoot).isDirectory()) return root;

	// mkdir is the one-time claim: if another touch already created the root, don't re-seed it.
	mkdirSync(root, { recursive: false });
	const copyTree = (from: string, to: string): void => {
		for (const name of readdirSync(from)) {
			if (from === parentRoot && name === ".runs") continue;
			const source = join(from, name);
			const destination = join(to, name);
			if (statSync(source).isDirectory()) {
				mkdirSync(destination);
				copyTree(source, destination);
			} else if (statSync(source).isFile()) {
				copyFileSync(source, destination);
			}
		}
	};
	copyTree(parentRoot, root);
	return root;
}
