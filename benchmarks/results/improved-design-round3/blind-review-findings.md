# Blinded behavior and repeated-work review

## Method and interpretation

Twenty-seven measured candidates (three tasks × three conditions × three repetitions) were assigned anonymous IDs, with the condition mapping kept separate from the reviewers until their reviews were complete. The packets included task specs, diffs, new/untracked files, action logs, worktree status, and final run summaries. The mapping is in `blind-review-mapping.json`.

Reviewers assessed completion against the task, honored/missed/not-observable task facts, final checks, and repeated work. **These fact counts are task-behavior coverage, not memory-attributable recall**: implementation prompts restate most/all gold facts. Repeated-work ratings are categorical (none/one/multiple) and are reported separately; they are not inferred from tokens or latency.

## Blinded completion and fact coverage by condition

| Task | Condition | Complete | Partial | Fact coverage | Main finding |
|---|---|---:|---:|---:|---|
| cost-ledger | Native | 1/3 | 2/3 | 17/18 | One candidate misses all-branch aggregation; another may overwrite observations by writing cost to the observer result path. |
| cost-ledger | Current OM | 2/3 | 1/3 | 18/18 | One candidate is partial: an earlier full focused run had two failures; final verification filtered/skipped 12 tests. |
| cost-ledger | Improved OM | 3/3 | 0/3 | 18/18 | All reviewed candidates complete. |
| session-scope | Native | 0/3 | 3/3 | 10/18 | One candidate misses parent seeding and `.runs` exclusion; another also has path-scoping issues. |
| session-scope | Current OM | 0/3 | 3/3 | 15/18 | All three cover five facts, but miss defer-root-creation behavior. |
| session-scope | Improved OM | 0/3 | 3/3 | 15/18 | All three cover five facts, but miss defer-root-creation behavior. |
| worker-cwd | Native | 3/3 | 0/3 | 9/9 | All three required cwd/root-launch facts honored. |
| worker-cwd | Current OM | 3/3 | 0/3 | 9/9 | All three required cwd/root-launch facts honored. |
| worker-cwd | Improved OM | 3/3 | 0/3 | 9/9 | All three required cwd/root-launch facts honored. |

### Session-scope issue across all conditions

The corrected review found the helper sources in the packets. It also found a shared functional defect: worker IPC writes under `.runs/` can create the session root even when parent memory is unavailable, bypassing the requirement to defer creating the root until a durable write. Therefore **none of the nine session-scope candidates is complete**, including all current- and improved-OM candidates. Some native candidates additionally miss seeding or `.runs` exclusion; one has IPC path argument errors. See `blind-review-candidate-scores.json` for per-candidate fact scores, final-check summaries, and concise evidence; `blind-review-mapping.json` maps the anonymous IDs to archived trials.

### Cost-ledger check caveat

All candidates eventually had a successful final recorded focused-test command and typecheck. The reviewers also noted earlier failures. In particular, one current-OM and one native candidate had two failures in an earlier full focused run; their final command passed only after filtering tests and skipping 12. Those two candidates remain partial in the blinded completion assessment rather than being treated as fully verified.

## Repeated work

Counts are candidates classified as none / one / multiple. “One” or “multiple” reflects objectively avoidable broad repository exploration before focused inspection (or its repetition), according to the task-specific rubric; necessary focused inspection and post-edit verification are not counted.

| Task | Native | Current OM | Improved OM |
|---|---:|---:|---:|
| cost-ledger | 3 / 0 / 0 | 0 / 2 / 1 | 0 / 3 / 0 |
| session-scope | 0 / 0 / 3 | 0 / 1 / 2 | 0 / 0 / 3 |
| worker-cwd | 0 / 0 / 3 | 0 / 2 / 1 | 1 / 1 / 1 |

There is no consistent reduction in repeated work with observational memory. In these small samples, all session-scope candidates and all native worker-cwd candidates were rated “multiple.”

## Recommendation and limitations

The improved-OM condition has a small correctness edge on cost-ledger, but no condition completed the session-scope task, and worker-cwd correctness was tied. Repeated-work findings do not favor OM consistently. Combined with the task-level cost/latency trade-offs in `round-summary.md`, this benchmark provides **no consistent evidence that OM improves coding outcomes enough to justify its added cost and complexity**.

This is not evidence that source recall is ineffective: no consolidator ran in any measured trial, so durable consolidation and `recall_source` were not exercised. The prompts also restated the facts, preventing attribution of coverage to memory. Treat the recommendation as **no demonstrated benefit under this benchmark, not a definitive rejection of observational memory**. Keep issues #2 and #7 open until a benchmark activates source recall without restating the recall targets and the session-root creation defect is addressed; do not claim recall improvement from this round.
