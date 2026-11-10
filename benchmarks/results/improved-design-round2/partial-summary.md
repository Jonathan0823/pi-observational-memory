# Improved-design benchmark round 2 — partial checkpoint

## Status

The planned matrix was 3 tasks × 3 conditions × (1 shakedown + 3 measured repetitions) = 36 trials. The execution environment stopped the run after 60m 41s: **11 succeeded, 1 was interrupted, and 24 were not started**. There was no quota-driven reduction. The only task reached was `cost-ledger`.

- All three cost-ledger shakedowns succeeded.
- Measured trials: native 3/3, current OM 3/3, improved OM 2/3; `cost-ledger-improved-om-r3` was interrupted before a result was recorded.
- No session-scope or worker-cwd trials ran.
- See `manifest.json` for portable trial status, `manifest.checkpoint.json` for the exact original runner checkpoint, and `trials/` for preserved output (verbose JSONL logs are gzip-compressed).

## Cost-ledger measured outcomes

These are descriptive partial samples, not a completed three-condition comparison. Tokens include main-session usage plus recorded OM worker tokens. Spend is split into main and worker usage; the displayed total is their sum. Latency is elapsed seconds.

| Condition | n | Median latency | Median main spend | Median worker spend | Median total spend | Median tokens | OM observer entries |
|---|---:|---:|---:|---:|---:|---:|---:|
| Native | 3 | 299.0s | $0.04528 | $0 | $0.04528 | 2,249,609 | 0 |
| Current OM | 3 | 277.4s | $0.03956 | $0 | $0.03956 | 2,106,232 | 0 |
| Improved OM | 2 | 331.7s | $0.04773 | $0.00726 | $0.05499 | 2,428,837 | 1 per run |

Current OM produced no observer entries in these trials, so its measurements do not represent an exercised OM condition and should not be interpreted as an OM cost or outcome comparison. Improved OM did start one observer in each completed measured trial. This needs diagnosis before a rerun.

Individual measured values:

| Trial | Latency | Main spend | Worker spend | Total tokens |
|---|---:|---:|---:|---:|
| Native r1 | 299.0s | $0.04528 | $0 | 2,249,609 |
| Native r2 | 228.2s | $0.03561 | $0 | 1,491,522 |
| Native r3 | 363.4s | $0.05766 | $0 | 2,660,500 |
| Current OM r1 | 277.4s | $0.03956 | $0 | 2,106,232 |
| Current OM r2 | 312.8s | $0.04049 | $0 | 2,343,805 |
| Current OM r3 | 190.4s | $0.03017 | $0 | 1,465,591 |
| Improved OM r1 | 281.3s | $0.04227 | $0.00727 | 2,004,928 |
| Improved OM r2 | 382.2s | $0.05320 | $0.00724 | 2,852,746 |

## Correctness, recall, and repeated work

No blinded behavior review or per-fact/repeated-work scoring was completed before the run stopped. The preserved interaction logs and diffs are available for later scoring, but the preregistered protocol also notes that the final task prompts restate most memory facts; observed fact coverage would not establish memory-caused recall. Do not infer recall or repeated work from tokens, spend, or latency.

Test evidence is incomplete and uneven across candidates. For example, improved-OM r2 finished with its focused suite passing (15 tests) and typecheck passing; other candidates had dependency-install and pre-existing gauge-test issues recorded in their logs. These are not a substitute for the planned blinded behavior review.

## Recommendation and next steps

This checkpoint does **not** answer whether improved OM is worth its complexity or worker cost. Do not close issue #7 or issue #2. Before any further paid run, fix the runner to prepare dependencies consistently and diagnose why current OM emitted no observations; then decide whether to complete the remaining 24 trials. Recall/repeated-work evaluation needs probes whose required facts are not repeated verbatim in the final implementation prompt.

Protocol and fixed settings: [`evaluation-protocol.md`](evaluation-protocol.md), [`manifest.json`](manifest.json). Baseline round-one task hashes and snapshots remain recorded in [`../measured-round1/manifest.json`](../measured-round1/manifest.json).
