# Blind-ish behavior review

Reviewed source diffs and tests only for candidates A–D; no run/session artifacts were inspected and no candidate files were changed. Requirements were taken from the supplied task briefs and implementation notes. Labels are intentionally not inferred or disclosed.

## Results

| Candidate | Assessment | Summary |
|---|---|---|
| A | **Pass with an edge-case caveat** | Session-root isolation, parent-ID seeding, `.runs/` exclusion, runtime paths, and topic path rendering are implemented. A failed copy can leave a partial child root which is then treated as a completed root on the next access. |
| B | **Partial / one concrete unmet criterion** | Core session scoping, deferred root creation for unavailable parent memory, and one-time fork seeding are implemented. Returned topic paths still omit the session ID, so rendered/indexed paths point outside the new root. Copy/setup failure handling also has an edge case. |
| C | **Pass** | Both worker roles use `runtime.memoryRoot` as cwd; spawn creates that directory before launch. IPC and sandbox env use the same root. |
| D | **Pass** | Same observed worker-cwd behavior and verification as C. |

## Evidence and details

### Candidate A

- Session-root selection is keyed by `getSessionId()` and uses the parent session header ID; existing roots short-circuit reseeding: `src/memory/paths.ts:30-45`.
- Parent content is copied while filtering `.runs` path segments: `src/memory/paths.ts:46-50`.
- Status, compaction, consolidator prompt/index, worker IPC, and sandbox routes pass session context: e.g. `src/commands/status.ts:23-24`, `src/hooks/compaction-hook.ts:153-154`, `src/hooks/consolidator-trigger.ts:59-60,143`, `src/hooks/observer-trigger.ts:41,154,162`.
- Topic paths include `.memory/<sessionId>/…`: `src/memory/paths.ts:155-157`.
- **Caveat:** root creation precedes `cpSync`, and the catch swallows copy errors (`src/memory/paths.ts:46-53`). If a copy fails after target creation, a later call sees `existsSync(root)` and treats the partial root as complete (`:36`), preventing a retry. The supplied tests cover absent parent memory and normal copy, not copy failure.

### Candidate B

- Root resolution and one-time fork copy use the parent header's ID, reject unreadable/missing parent inputs without creating a child root, and skip top-level `.runs`: `src/memory/session-root.ts:14-45`.
- Session root is wired into session startup and into compaction/status/consolidator/observer paths: `src/index.ts:45-53`, `src/commands/status.ts:23-27`, `src/hooks/compaction-hook.ts:153-157`, `src/hooks/consolidator-trigger.ts:114-121,143`, `src/hooks/observer-trigger.ts:41,154,162`.
- **Concrete unmet criterion:** `listTopics` reads files from the session root but emits `Topic.path` as `.memory/<filename>`, omitting the session ID (`src/memory/paths.ts:114-128`, especially line 124). Consequently index/map entries identify the wrong path for session-scoped topic files. Candidate A includes the session ID in the equivalent path.
- **Edge-case caveat:** `ensureSessionMemoryRoot` creates the child directory before enumerating/copying the parent (`src/memory/session-root.ts:36-40`) and has no rollback. An invalid/non-directory parent root or copy error can therefore leave an empty/partial target; future calls return it as complete at line 28. `getHeader()` and validation of the parent ID are also outside the guarded header-read helper (`:30-35`), so malformed owner/header values can throw rather than defer cleanly. Normal tested parent/missing-parent cases pass.

### Candidates C and D

- Both observer and consolidator spawn with `cwd: runtime.memoryRoot`: `src/hooks/observer-trigger.ts:154-155`, `src/hooks/consolidator-trigger.ts:120-121`.
- Spawn creates the cwd recursively before invoking the process: `src/spawn/launch.ts:66-80` (the `mkdirSync` call is at line 74).
- Both roles build IPC and sandbox environment from the same runtime root: `src/hooks/observer-trigger.ts:154,162`, `src/hooks/consolidator-trigger.ts:120`; `src/spawn/launch.ts:112-122`.
- Existing model/prompt/cancellation/exit paths remain in place around the changed cwd calls. A focused smoke test verifies a fresh root is created and observed as the child process cwd: `tests/spawn.smoke.test.ts` (new case in each candidate).
- No concrete unmet worker-cwd criterion found in either diff.

## Verification

All focused checks passed:

- Candidate A: `npm run typecheck`; `npx vitest run tests/memory.session.test.ts tests/spawn.smoke.test.ts` — 2 files, 13 tests passed.
- Candidate B: `npm run typecheck`; `npx vitest run tests/memory.session-root.test.ts tests/spawn.smoke.test.ts` — 2 files, 12 tests passed.
- Candidate C: `npm run typecheck`; `npx vitest run tests/spawn.smoke.test.ts` — 1 file, 9 tests passed.
- Candidate D: `npm run typecheck`; `npx vitest run tests/spawn.smoke.test.ts` — 1 file, 9 tests passed.

`git diff --check` also passed for all four worktrees.
