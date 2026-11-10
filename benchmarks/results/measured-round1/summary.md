# GPT-6 Luna baseline: three measured repetitions

## Protocol

Three fresh worktree/session repetitions per task and condition, each with the same 12 seed turns, an explicit RPC `compact`, then the implementation prompt. Main and observer/consolidator used `openai-codex/gpt-6-luna`; main thinking=high, observer=low, consolidator=medium. Request pacing was disabled. OM `chunkTokens` remained 60,000. The worker-cwd r3 OM retry used a benchmark-only `compactAtContextTokens=100,000` to avoid an auto-compaction race; this does not change the 60k observer trigger. The three seed JSON files, their hashes, raw result JSON, test logs, and retry notes are retained alongside this report.

`src/spawn/launch.ts` in the benchmark host checkout contains the production stdin fix for Linux `spawn E2BIG`; it is not included in the task-start snapshots. Report these runs as using the patched benchmark host.

## Results by task

Medians across n=3, descriptive only. Spend is main-session usage plus recorded OM worker spend; tokens add main and worker input/output/cache counts. These measures are not combined across tasks.

| Task | Condition | Median elapsed | Median spend | Median tokens |
|---|---|---:|---:|---:|
| cost-ledger | Native | 324.1s | $0.04378 | 2,080,177 |
| cost-ledger | OM | 340.9s | $0.04385 | 2,026,687 |
| session-scope | Native | 309.6s | $0.04001 | 1,876,172 |
| session-scope | OM | 376.1s | $0.04412 | 2,168,268 |
| worker-cwd | Native | 256.9s | $0.02817 | 1,014,892 |
| worker-cwd | OM | 155.4s | $0.02906 | 1,066,556 |

The successful OM trials recorded one observer cost entry in most runs (session-scope r2 recorded two); worker-session cost from Pi JSONL matched the OM ledger cost in all measured trials. Native has no worker usage. The individual runs vary substantially, so medians should not be treated as stable performance estimates.

## Task correctness and tests

Typecheck passed in all 18 measured candidates. Full test results:

- **cost-ledger:** Native r1 passed (95); r2 and r3 each had failures (4 and 2). OM r1 and r2 each had 2 failures; OM r3 passed (102). The source review found concrete handoff/result-path defects in native r2 and OM r1; other candidates ranged from plausible/partial to uncertain due missing focused integration tests. See [review](review-cost-ledger.md).
- **session-scope:** All six full suites passed (97–99 tests). Source review nevertheless found fork-seeding defects missed by tests: native r2/r3 and OM r3 split on literal `\\n`, not a newline; other candidates have header-validation caveats. OM r2 had no concrete gap found. See [review](review-session-scope.md).
- **worker-cwd:** All six full suites passed (99 tests); source review found all six satisfy the worker-cwd requirements. See [review](review-worker-cwd.md).

The task is reconstructed, and candidates implement independently; different runs can contain different bugs. The task results do not establish a reliable OM correctness advantage. The only clear across-run success is worker-cwd, where both conditions passed.

## Recall and repeated work

Not scored in this round. The protocol did not define pre-registered recall probes or a reliable repeated-work rubric, and the source reviewers deliberately did not inspect session transcripts. Token totals and latency are not valid proxies for either. Do not report these as zero; a separate transcript evaluation is required to satisfy those acceptance metrics.

## Interpretation

No general performance conclusion. On these tasks, OM was near-native median spend for cost-ledger, about 10% higher for session-scope, and about 3% higher for worker-cwd. Latency varied by task: OM was slower on cost-ledger/session-scope and faster on worker-cwd. Given the correctness defects/uncertainty and unscored recall/repeated work, this round does **not** show that observational memory improves coding outcomes enough to justify its added cost. Keep issue #2 open pending the recall/rework evaluation and any agreed follow-up.

## Invalid attempts retained in manifest

- Cost-ledger OM r3 first attempt was killed by the outer tool timeout while native r3 remained valid; subsequent attempts hit transient Codex overload twice, then a successful replacement completed the third OM repetition.
- Worker-cwd OM r3 initially auto-compacted at 83,168 tokens before the explicit RPC command, so the runner saw `Already compacted`; that attempt was excluded and replaced with an explicit-compaction run using the 100k auto threshold.

These invalid attempts were not counted among the 18 measured results.
