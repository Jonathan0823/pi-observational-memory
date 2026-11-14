import { existsSync, mkdirSync, readFileSync, readdirSync, cpSync } from "node:fs";
import { join } from "node:path";
import { memoryDir } from "./paths.js";

type SessionIdentity = { id: string; parentSession?: string; cwd?: string };

function readHeader(path: string): SessionIdentity | undefined {
	try {
		const firstLine = readFileSync(path, "utf-8").split("\n", 1)[0];
		const header = JSON.parse(firstLine) as Partial<SessionIdentity>;
		return typeof header.id === "string" ? { id: header.id, parentSession: header.parentSession, cwd: header.cwd } : undefined;
	} catch {
		return undefined;
	}
}

/** Resolve the immutable-header-ID memory root and lazily seed a fork from its parent. */
export function sessionMemoryRoot(cwd: string, header: SessionIdentity | null | undefined): string | undefined {
	if (!header || typeof header.id !== "string" || header.id.length === 0) return undefined;
	const child = memoryDir(cwd, header.id);
	if (existsSync(child)) return child; // Resume never reseeds or overwrites child state.
	if (!header.parentSession) return child;

	const parent = readHeader(header.parentSession);
	if (!parent) return child;
	const parentRoot = memoryDir(parent.cwd ?? cwd, parent.id);
	if (!existsSync(parentRoot)) return child;

	mkdirSync(child, { recursive: true });
	for (const name of readdirSync(parentRoot)) {
		if (name === ".runs") continue;
		cpSync(join(parentRoot, name), join(child, name), { recursive: true, errorOnExist: false, force: false });
	}
	return child;
}

export function sessionMemoryId(header: SessionIdentity | null | undefined): string | undefined {
	return header && typeof header.id === "string" && header.id.length > 0 ? header.id : undefined;
}
