# Cost-ledger paired shakedown (stdin launch fix)

Status: execution, candidate tests, and condition-label-suppressed behavior review complete. Not a measured repetition and not evidence of a general OM advantage.

## Setup

- Model: `openai-codex/gpt-6-luna`; main thinking high, observer low, consolidator medium.
- Two fresh detached worktrees at `009f292ae4885e01c5cc5bced0b02ab8343412f6`.
- Identical 12 source/API context packets, followed by explicit RPC compaction and the same implementation prompt.
- Configured observer chunk: 60,000 tokens. No artificial pacing or quota pauses.
- OM uses current extension source plus the production stdin-launch bug fix; this is a patched baseline, not the previously broken implementation.
- Seed SHA-256: `05c3d9f823d223418eda4e7bee8b38549f46b6a98d8e2e49085eacb2efaf1efc`.
- Artifacts: `/tmp/om-patched-shakedown-6crx20/` (manifest, extension snapshot archive, sessions, RPC events, diffs, test output, metrics). These are local VM artifacts, not permanent hosted results.

## Execution metrics

| Metric | Native | OM |
| --- | ---: | ---: |
| Total elapsed seconds | 261.67 | 265.97 |
| Implementation seconds | 223.14 | 224.00 |
| Explicit compaction seconds | 16.29 | 10.33 |
| Context tokens before compaction | 77,512 | 77,536 |
| Main input tokens | 213,402 | 192,455 |
| Main output tokens | 8,951 | 7,582 |
| Main cache-read tokens | 1,647,104 | 1,909,632 |
| Worker input tokens | 0 | 62,532 |
| Worker output tokens | 0 | 599 |
| Worker cache-read tokens | 0 | 61,568 |
| Main estimated USD | 0.04228674 | 0.04213282 |
| Worker estimated USD | 0 | 0.00716838 |
| Total estimated USD | 0.04228674 | 0.04930120 |
| Tool calls | 47 | 50 |
| Observations rendered in OM summary | N/A | 7 |
| Typecheck | pass | pass |
| Candidate test suite | 94 passed | 93 passed |

Main usage includes native compaction; its $0.00609670 component is **not added again**. Costs are Pi/model-catalog estimates, not verified bills. Worker sessions were copied into the OM artifact directory. Both cache-write totals are zero. Cache effects, run order, and stochastic variation are not controlled by this single pair.

OM was approximately 16.6% more expensive and 1.6% slower in this one pair. This is descriptive only; correctness review and repeated trials are required before conclusions.

## Scoring caveats

- Candidate-authored tests are not independent acceptance tests and do not alone establish completion.
- Reference tests that hard-code implementation export names are not used as behavioral failure counts.
- Both compaction summaries preserve the task's six requirement categories; this does not prove correct implementation or isolate a recall effect (the final prompt also repeats requirements).
- Repeated `read` paths were observed in both candidates. Re-reading edited files is often legitimate verification; raw repeat counts are not scored as unnecessary work.
- Condition-label-suppressed review found the native candidate appears to satisfy the requested behavior. The OM candidate handles the main flow but records zero cost for empty worker message arrays (no valid usage) and accepts blank run IDs. These are validation gaps, not evidence of lost remembered requirements; a phantom zero-cost entry does not increase the monetary total.
- Review was source-based plus focused candidate tests, not rigorously blinded or backed by an independent lifecycle integration suite. The all-branches behavior uses the real Pi `getEntries()` API in both candidates. Neither result has a fully independent acceptance-test score yet.
- Review evidence is preserved in `review.md`; original VM report: `/tmp/om-patched-shakedown-6crx20/blind-evaluation.md`.
