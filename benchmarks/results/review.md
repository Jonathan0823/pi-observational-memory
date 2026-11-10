# Blind candidate evaluation: worker usage cost

**Scope note:** This is a condition-label-suppressed review of the two named worktrees, not a rigorous independent blinding. I did not inspect benchmark condition labels or session files. Evaluation is based on candidate source/diffs and focused tests; no candidate source was modified.

## Summary

| Criterion | Candidate A (`native-worktree`) | Candidate B (`om-worktree`) |
|---|---|---|
| Actual usage collection for observer and consolidator, transferred to parent | Pass | Pass, with a missing-usage edge case noted below |
| Capture valid usage from unsuccessful worker runs | Pass | Pass |
| Ledger persistence includes role and run identity | Pass | Pass |
| Aggregate all session branches, including abandoned branches | Pass | Pass when `getEntries()` is available; otherwise falls back to active branch |
| Reject missing/malformed/nonfinite/negative cost data | Pass | **Partial**: rejects invalid cost values, but empty assistant usage can be recorded as zero; blank run IDs pass validation |
| Status/footer displays total | Pass | Pass |
| Focused tests | Pass (8 tests) | Pass (7 tests) |

**Overall completion:** A appears to satisfy the requested behavior. B implements the main flow, but does not fully satisfy strict rejection of missing usage and malformed identity. Passing tests are not equivalent to complete behavioral coverage: the tests exercise helpers/rendering, not end-to-end worker lifecycle or branch-tree integration.

## Candidate A

- **Usage collection and parent handoff — Pass.** `agent/index.ts:21-38` sums finite, nonnegative `assistant` message `usage.cost.total` values, requires at least one valid usage value (`found`), and persists usage alongside observations. Both worker roles call this at `agent_end` (`agent/index.ts:50-51, 68-69`). Parent dispatchers read the worker result and append cost ledger entries (`src/hooks/observer-trigger.ts:139-140`; `src/hooks/consolidator-trigger.ts:123-124`).
- **Unsuccessful runs — Pass.** The parent reads/appends usage immediately after `spawnWorker`, before testing `exit.code` (`src/hooks/observer-trigger.ts:138-145`; `src/hooks/consolidator-trigger.ts:122-129`). Thus a worker that emitted `agent_end` usage but exits unsuccessfully still contributes cost.
- **Ledger identity and validation — Pass.** Ledger data requires role, nonempty run ID, and finite nonnegative numeric cost (`src/ledger/types.ts:21-29`); invalid ledger entries are ignored in `totalWorkerCost` (`src/ledger/types.ts:33-38`).
- **All branches — Pass.** `totalWorkerCost` consumes a supplied complete entry list (`src/ledger/types.ts:33-38`). Startup and enable refreshes pass `sessionManager.getEntries()` (`src/index.ts:50,71`); status uses the full entries list (`src/commands/status.ts:20`). Worker completion refreshes also passes all entries where available (`src/hooks/observer-trigger.ts:89,157`; `src/hooks/consolidator-trigger.ts:147`).
- **Display — Pass.** Status command prints `worker cost` (`src/commands/status.ts:34`); footer includes formatted total when provided (`src/ui/status-controller.ts:176-181`).
- **Tests — Pass, limited coverage.** `npm test -- --run tests/worker-cost.test.ts tests/status-controller.test.ts`: 2 files, 8 tests passed. These cover summing/invalid values, IPC helper behavior, and footer rendering; not end-to-end hook integration.

## Candidate B

- **Usage collection and parent handoff — Pass with caveat.** The worker registers an `agent_end` listener for both roles and extracts assistant usage (`agent/index.ts:27,45,63-74`). Parent reads the role/run-specific usage file and appends the ledger entry (`src/hooks/observer-trigger.ts:139-142`; `src/hooks/consolidator-trigger.ts:123-126`). The usage file path is derived from the worker run ID (`src/spawn/runs.ts:26-42`; `src/spawn/launch.ts:113-116`).
- **Unsuccessful runs — Pass.** Both parent paths read and append usage before checking nonzero exit status (`src/hooks/observer-trigger.ts:139-145`; `src/hooks/consolidator-trigger.ts:123-129`).
- **Ledger identity and validation — Partial.** Role and run ID are persisted (`src/hooks/observer-trigger.ts:141`; `src/hooks/consolidator-trigger.ts:125`), and cost is required to be a finite nonnegative number (`src/ledger/types.ts:18-22`). But `isWorkerCostData` only checks that `runId` is a string; an empty string passes (`src/ledger/types.ts:20`).
- **Missing usage — Fail for strict missing-cost rejection.** In `agent/index.ts:67-74`, an empty `event.messages` array produces a reducer result of `0`; `writeWorkerUsage` then writes it as valid cost (`src/spawn/runs.ts:41-43`). That can persist a zero-cost ledger entry despite there being no valid usage value. By contrast, absent `event.messages` remains undefined. The requirements explicitly call for rejecting missing costs.
- **All branches — Pass with API fallback caveat.** Status and lifecycle paths pass `getEntries()` when present (`src/commands/status.ts:18,34`; `src/index.ts:50,71`; hooks at `src/hooks/observer-trigger.ts:89,142,160` and `src/hooks/consolidator-trigger.ts:126,150`). `Runtime.refreshFooterGauges` defaults to the active branch (`src/runtime.ts:108`), and status falls back to the active branch when `getEntries()` is absent (`src/commands/status.ts:18`). Therefore full-tree aggregation depends on the session manager exposing `getEntries()`.
- **Display — Pass.** Status prints the aggregate (`src/commands/status.ts:34`); footer formats the cost (`src/ui/status-controller.ts:178-181`).
- **Tests — Pass, limited coverage.** `npm test -- --run tests/worker-cost.test.ts tests/status-controller.test.ts`: 2 files, 7 tests passed. Helper tests cover absent/malformed/nonfinite/negative IPC values, valid aggregation, and footer output, but do not test empty `event.messages` or empty run ID, explaining the gaps above.

## Verification

Ran the focused Vitest files in each worktree. Candidate A: 8/8 tests passed. Candidate B: 7/7 tests passed. No source changes were made.
