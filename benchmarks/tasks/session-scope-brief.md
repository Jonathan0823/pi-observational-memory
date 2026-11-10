Reference task requirements for a later implementation turn; this is context, not an instruction to act yet.

The current project-level `.memory/` layout lets separate Pi sessions share durable memory. Change the design so each session's long-term memory belongs to its immutable session ID under `.memory/<sessionId>/`.

A child/fork session should be seeded from its parent's memory once, on first touch. Discover the parent from the session header's `parentSession` path, read that session file's header ID, and use the parent's session-specific memory root. Do not use mutable display names or filename IDs as identity. Skip transient `.runs/` data when copying. If the parent has no readable session header or no memory root, leave the child root uncreated until its first durable write. Existing child memory must never be overwritten or re-seeded on resume.

All durable-memory reads/writes, compaction memory-map rendering, journey access, and worker IPC paths must use the owning session's memory root. Preserve existing short-term ledger `/tree` behavior; durable per-session files remain independent from ledger branches.
