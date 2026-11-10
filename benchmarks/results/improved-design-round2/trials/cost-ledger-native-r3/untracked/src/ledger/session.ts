import type { Entry } from "./types.js";

/**
 * Return the session's full entry stream when the manager exposes it, falling back to the
 * visible branch for lightweight/test managers. Cost entries are intentionally session-wide,
 * so this includes entries from branches abandoned by tree navigation.
 */
export function allSessionEntries(sessionManager: unknown, branch: Entry[]): Entry[] {
	if (!sessionManager || typeof sessionManager !== "object") return branch;
	const getEntries = (sessionManager as { getEntries?: () => unknown }).getEntries;
	if (typeof getEntries !== "function") return branch;
	try {
		const entries = getEntries.call(sessionManager);
		return Array.isArray(entries) ? (entries as Entry[]) : branch;
	} catch {
		return branch;
	}
}
