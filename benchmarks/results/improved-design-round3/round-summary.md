# Improved observational-memory evaluation — round 3

## Status

The fresh matched matrix is complete: **36/36 trials succeeded** (one shakedown plus three measured repetitions for each of three tasks and three conditions). No quota-driven reduction occurred. The current-OM condition uses commit `856ff90`, which includes the required large-worker-prompt stdin fix; dependencies were installed with `npm ci` before each trial and setup time was excluded from measured latency.

All 27 measured candidates completed the RPC task. The last recorded focused acceptance-test command and last typecheck command exited successfully for all 27. Some candidates had an initial test/typecheck failure and corrected it before final verification; the full attempt history is in the logs and `checks.json`.

## Measured medians (n=3; descriptive)

Spend columns are main-session and OM-worker usage separately; total spend is the median of per-trial combined spend. Token columns are main / worker / combined counts. Latency is elapsed task-session time. Do not combine these into a score.

| Task | Condition | Latency | Main spend | Worker spend | Total spend | Main tokens | Worker tokens | Total tokens |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| cost-ledger | Native | 225.3s | $0.03727 | $0 | $0.03727 | 1,630,882 | 0 | 1,630,882 |
| cost-ledger | Current OM | 325.3s | $0.03799 | $0.00717 | $0.04506 | 2,006,726 | 124,684 | 2,131,079 |
| cost-ledger | Improved OM | 284.2s | $0.04014 | $0.00749 | $0.04727 | 2,288,374 | 125,751 | 2,412,937 |
| session-scope | Native | 308.6s | $0.05215 | $0 | $0.05215 | 2,693,991 | 0 | 2,693,991 |
| session-scope | Current OM | 321.1s | $0.04605 | $0.00651 | $0.05257 | 2,623,020 | 112,783 | 2,735,803 |
| session-scope | Improved OM | 260.9s | $0.03850 | $0.00640 | $0.04489 | 2,162,351 | 112,403 | 2,274,754 |
| worker-cwd | Native | 111.4s | $0.03082 | $0 | $0.03082 | 1,034,157 | 0 | 1,034,157 |
| worker-cwd | Current OM | 89.2s | $0.02213 | $0.00658 | $0.02871 | 947,999 | 115,880 | 1,063,879 |
| worker-cwd | Improved OM | 89.0s | $0.02206 | $0.00681 | $0.02882 | 945,555 | 116,633 | 1,062,188 |

## Memory activity and evaluation limitations

Each OM trial produced observer activity. The session-scope/current-OM r2 trial produced two observer sessions; other measured OM trials produced one each. **No consolidator ran in any measured trial**, so durable topic consolidation and `recall_source` were not exercised. Therefore these runs cannot establish whether source recall improves coding outcomes.

The implementation prompts restate most/all memory facts present in the seeds. Fact coverage can be scored from behavior, but it cannot be attributed to retrieval from memory. The blinded behavior/fact/repeated-work reviews are in progress; do not interpret this report as their result.

## Artifacts

- `manifest.json`: settings, snapshots, source commits, and all trial statuses.
- `checks.json`: per-candidate test/typecheck command history and final outcomes.
- `evaluation-protocol.md`: scoring rubric and blinding procedure.
- `cells/<task>-<condition>/`: per-cell manifests and preserved trial logs, results, diffs, and untracked outputs. Verbose JSONL transcripts are gzip-compressed.
- `../improved-design-round2/partial-summary.md`: record of the earlier invalid/interrupted attempt and its cause.

A final recommendation remains pending the blinded behavior review. Do not close issues #2 or #7 until the review is recorded and the limits around source-recall activation are addressed.
