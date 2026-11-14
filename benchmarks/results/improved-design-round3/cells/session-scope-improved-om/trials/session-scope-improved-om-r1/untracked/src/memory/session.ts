export type SessionMemoryOptions = { sessionId?: string; parentSessionPath?: string };

/** Immutable identity and parent path from pi's session header (never display metadata). */
export function sessionMemoryOptions(sessionManager: {
	getHeader?: () => { id?: string; parentSession?: string } | undefined;
}): SessionMemoryOptions {
	const header = sessionManager.getHeader?.();
	return { sessionId: header?.id, parentSessionPath: header?.parentSession };
}
