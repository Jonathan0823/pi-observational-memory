# Cost-ledger measured-candidate review

Source-only review of six measured candidate diffs/tests; no run artifacts inspected. Pair labels were condition-suppressed during review. Mappings are recorded here for audit: pair 1 A=native/B=OM; pair 2 A=OM/B=native; pair 3 A=native/B=OM.

| Trial | Review |
|---|---|
| Native r1 (pair 1 A) | Appears to cover worker usage handoff, ledger persistence on success/failure, branch aggregation, validation, and display. Changed tests only cover the usage-path environment variable; focused coverage for aggregation, invalid entries, handoff, and display is missing. |
| OM r1 (pair 1 B) | **Fail:** worker writes a bare cost number, but parent expects an object with a `cost` property; no ledger cost is read or appended. (`agent/index.ts`, `src/spawn/runs.ts`) |
| OM r2 (pair 2 A) | Partial/uncertain: derives worker cost from `agent_end` event messages; no changed test establishes that the event contains usage-bearing messages. No focused tests for handoff, invalid entries, aggregation, or display. |
| Native r2 (pair 2 B) | **Fail:** writing cost to `resultPath` overwrites observer output; orchestrator reads that same path as the observations result. (`agent/index.ts:34,48`, `src/spawn/runs.ts`, `src/hooks/observer-trigger.ts:143`) |
| Native r3 (pair 3 A) | Partial: `finally`-based import preserves output and supports unsuccessful runs; changed tests cover result/cost preservation and footer display, but not cross-branch aggregation or malformed entries. Full test run has two status-controller failures. |
| OM r3 (pair 3 B) | Partial/pass by source inspection: separate cost file and `finally` import appear to support unsuccessful runs; aggregation validates role, run ID, and cost. No changed tests for the required handoff, invalid-entry, aggregation, and display cases. Full test run passes. |

All six candidates typecheck. Full suite results are preserved in `tests/`; test failures are not treated as proof of a behavior failure unless they correspond to the task's stated acceptance behavior. This review is source-based, not a runtime integration test.
