# Observational-memory baseline

Status: **three measured repetitions per task and condition are complete using GPT-6 Luna and the stdin launch fix. Typechecks passed; independent source review found task-specific correctness bugs that ordinary suites missed. Recall and repeated-work scoring remain unmeasured, so issue #2 stays open. Results are descriptive; no general performance conclusion. See [round 1 report](results/measured-round1/summary.md).**

## Purpose

Compare native compaction with the current observational-memory implementation on coding tasks, then reuse the same task set after the consolidation-accounting and source-recall changes. This is a coding-completion benchmark, not a compression-ratio benchmark.

## Source and limitations

The project's saved history contains the current design discussion but no separate historical coding-task transcripts. The tasks below are reconstructed from real feature commits and their tests, not copied from original user prompts. Their target commits provide fixed snapshots and behavioral references, but results should be interpreted as performance on reconstructed tasks rather than exact replay of the original development sessions.

## Task set

Each task starts at its listed parent commit. The associated target commit is a reference for the intended behavior and existing tests, not an instruction to copy the patch.

| ID | Reconstructed task | Start snapshot | Reference change |
| --- | --- | --- | --- |
| cost-ledger | Record actual observer/consolidator spend from pi usage, persist it per session even for ephemeral/failed workers, and surface the total in status/footer. | `009f292ae4885e01c5cc5bced0b02ab8343412f6` | `e9f7bacb2375629f7b27c9e5801b7c07e006b11e` |
| session-scope | Isolate durable memory by immutable session ID; seed a fork once from its parent while excluding transient run files. | `7eabcf572ea2c5b6cd37dcfbebe7540a866e1456` | `844292dd084bfe7cd36ed1aa44666b08a8b1a482` |
| worker-cwd | Run each worker from the owning session's memory root so worker sessions are isolated from ordinary project-session discovery. | `844292dd084bfe7cd36ed1aa44666b08a8b1a482` | `65e4f1e71507729c558441fcb76c28218a0335b2` |

## Run settings

- Main agent: `openai-codex/gpt-6-luna` at high thinking.
- Observer and consolidator: `openai-codex/gpt-6-luna`, with low and medium thinking respectively; the RPC runner writes these settings into each isolated worktree.
- OM trigger settings: preserve the VM's configured `chunkTokens: 60000`; the runner does not lower the threshold for scored trials.
- Conditions: native compaction; current observational memory.
- Repetitions: one shakedown, then three measured runs per task and condition. Record quota-driven reductions.
- Evaluation: target-snapshot tests plus condition-label-suppressed source review. A task succeeds only when acceptance behavior and tests both pass.
- Report per run: completion, memory facts recalled/missed, repeated work, input/output/cache tokens where available, reported spend or quota usage, and elapsed time. Do not combine these into one score. Recall and repeated-work scoring are not yet defined/measured for round 1; do not infer them from token counts.

## Validated invocation protocol

- Use one long-lived Pi `--mode rpc` process per trial, in an isolated worktree and session directory. Disable unrelated extensions in both conditions. The runner does not add artificial waits by default; optional benchmark-only request pacing is available if a provider needs it, and its imposed wait is recorded separately.
- Native condition: load no observational-memory extension. OM condition: explicitly load `benchmarks/extensions/observational-memory.ts`; its benchmark-only session-start hook records `{ enabled: true }` without changing production defaults.
- Keep the process alive through the seed/planning turns so observer workers can finish. After both conditions reach the same planned checkpoint, send the same RPC `compact` command and require a successful response. Then send the implementation prompt in that same session.
- A too-short session must be rejected: Pi returned `Nothing to compact (session too small)` for the smoke sessions below its default 20,000-token retention. The paired smoke test used three equivalent seed turns, reached 33,860 tokens in native and 33,874 in OM, and successfully compacted both. OM recorded six observation entries before compaction. This validates the invocation path only; the content was synthetic and these are not coding-task results.
- Capture main-session usage with `get_session_stats`, OM worker spend from its ledger entries, and elapsed time around the same phases. Preserve RPC events, session files, worktree diff, and test output per trial.

## Run record

| Task | Condition | Shakedown | Measured runs | Status |
| --- | --- | --- | --- | --- |
| cost-ledger | Native | Measured: 3 reps; typecheck 3/3; full tests pass only r1; source review found one concrete handoff/path bug and two partial candidates | 3/3 | [Round 1 report](results/measured-round1/summary.md) |
| cost-ledger | Observational memory | Measured: 3 reps; typecheck 3/3; full tests pass only r3; source review found one concrete handoff bug and two partial/uncertain candidates | 3/3 | Same report and [review](results/measured-round1/review-cost-ledger.md) |
| session-scope | Native | Measured: 3 reps; all full tests pass; source review found two fork-seeding defects and one header-validation caveat | 3/3 | [Round 1 report](results/measured-round1/summary.md) |
| session-scope | Observational memory | Measured: 3 reps; all full tests pass; one candidate passes review, one has header-validation caveat, one fork-seeding defect | 3/3 | Same report and [review](results/measured-round1/review-session-scope.md) |
| worker-cwd | Native | Measured: 3 reps; all tests pass; all three pass behavior review | 3/3 | [Round 1 report](results/measured-round1/summary.md) |
| worker-cwd | Observational memory | Measured: 3 reps; all tests pass; all three pass behavior review | 3/3 | Same report and [review](results/measured-round1/review-worker-cwd.md) |

The initial Gemini attempts were invalidated by HTTP 429 free-tier input-token quota errors. Subsequent runs use GPT-6 Luna with pacing disabled. An initial 60k OM observer launch failed with Linux `spawn E2BIG` because the serialized conversation was passed as one argv argument. `src/spawn/launch.ts` now pipes the kickoff prompt through stdin; this preserves Pi's recorded-message semantics and is required for 60k chunks. The patched protocol produced real observations in all three OM shakedowns. This is a production bug fix, so report it as part of the baseline version.

## Remaining work

Define and run a separate transcript-based evaluation for recall and repeated work, with pre-registered probes and a behavior-based rubric; current token/latency results cannot substitute for these measures. Then compare improved OM against native and current OM on the same tasks. Keep issue #2 open until the missing evaluation is complete and the task/review defects are addressed or explicitly accepted. Do not lower OM thresholds or count non-triggering runs as evidence of memory performance.
