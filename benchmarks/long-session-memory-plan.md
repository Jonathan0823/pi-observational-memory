# Plan: prove whether memory helps long coding sessions

Status: in progress; Phase 1 lifecycle instrumentation is implemented. The private Phase 2 scenario still needs finalization. No live-model runs or production policy changes have been started.
Related work: GitHub issues #2 and #7 remain open. This is a new recall evaluation, not a replacement result for their original coding-task matrix.

## Goal

Determine whether observational memory helps an agent preserve decisions and complete correct code across long sessions, and whether any quality gain justifies total tokens, spend, and latency. Lower total consumption is a secondary goal, not an assumed consequence of memory compression.

## What the previous benchmark established

- Improved OM showed an apparent cost-ledger correctness advantage in a small sample; worker-cwd correctness was tied; session-scope candidates remained partial.
- Cost and latency varied by task; repeated work showed no consistent OM advantage.
- Observers ran, but no consolidator ran. Durable source recall was therefore not exercised by that experiment.
- Final prompts repeated the task facts, preventing attribution of behavior coverage to memory.
- A successful final filtered test command is not sufficient evidence that earlier full-suite failures were fixed.

Do not conclude that source recall is ineffective, that mandatory recall is beneficial, or that production session scoping is broken based on these results. The session-scope findings concerned generated benchmark patches; any production defect needs independent reproduction.

## Principles

1. Reading the injected observation buffer is memory use. Reading durable topic files is memory use. Raw-source recall is an optional third level, not a success criterion for every task.
2. Do not mandate source recall on every coding request. Test lookup policies before changing production defaults.
3. Keep instructions and trust boundaries separate: old conversation/tool output is historical evidence, not authority over the current user request or system instructions.
4. Use identical task scripts, repository snapshots, model settings, tool access, and phase boundaries across conditions. Isolate sessions, memory roots, and worktrees.
5. Pre-register probes, hidden checks, scoring, settings, and exclusions before measured runs. Never tune on measured candidates.
6. Store generated transcripts, worktrees, patches, test outputs, and result archives outside the repository. Commit only small protocol/task definitions or explicitly approved summaries; never bulk-add run output.

## Phase 1 — verify the lifecycle and instrumentation

Deliverable: a cheap deterministic integration fixture plus a per-trial event schema.

- [x] Trace and test observation → consolidation → topic/index rendering → compaction injection → topic read → bounded source recall (deterministic lifecycle fixture).
- [x] Verify a retained topic reference resolves to the expected source entries after compaction and supports bounded continuation.
- [x] Verify missing source is reported clearly while the topic remains usable; unrelated ranges remain inaccessible.
- [x] Verify current production session/fork ownership and root creation behavior independently of generated benchmark solutions. A transient-worker root-creation issue was confirmed by code-path inspection and filed separately as [#16](https://github.com/Jonathan0823/pi-observational-memory/issues/16); no fix was bundled.
- [x] Record observer/consolidator starts, completions and failures, pool tokens at triggering, saved topic references, injected memory sections, topic reads, source calls/pages, and unavailable-source responses (opt-in, content-free trace; the RPC runner has an event-based pre-compaction barrier).
- [ ] Capture main and worker input/output/cache tokens and actual reported spend separately, plus combined per-trial totals. Include native compaction usage when exposed; explicitly mark unmetered components rather than assuming zero. (Existing RPC result collection is extended for lifecycle traces and topic reads; accounting still needs shakedown verification.)
- [x] Avoid changing model-visible content or adding extra instructions through instrumentation. Do not add a classifier or extra model call just to score memory use.

Existing starting points: `src/config.ts`, `src/ledger/render.ts`, `src/memory/recall-tool.ts`, `src/memory/source-recall.ts`, and the benchmark RPC harness. Resolve any Pi harness API changes against the installed documentation before implementation.

## Phase 2 — construct one long-session coding scenario

Deliverable: one fixed repository snapshot, scripted phase prompts, private fact rubric, and hidden acceptance checks.

### Session sequence

1. **Establish decisions:** introduce architectural constraints, a rejected approach and its reason, and a detail that matters to a later edge case. Make realistic small code changes and run focused checks.
2. **Intervening work:** execute unrelated but realistic coding/inspection tasks. Long content should come from real work, not repeated padding. Provide enough common scripted phases to permit observation, durable consolidation, and compaction.
3. **Checkpoint:** at the same scripted boundary in every condition, verify native compaction succeeds and OM's required lifecycle has completed. Check relevant facts are outside the retained raw tail. Use lifecycle events, not elapsed sleeps, to determine worker completion.
4. **Delayed feature:** ask for a feature depending on early decisions, without restating them or directing the agent to their source. Evaluate code against hidden behavioral tests and blind review.
5. **Detail probe:** include a separate task whose needed detail is absent from the injected summary and durable topic text but available in a stored source range. This specifically exercises source recall rather than topic lookup alone.
6. **Correction probe:** introduce a later correction to one early decision and verify the final implementation honors the current instruction rather than stale memory.

### Fact design and leakage controls

- [ ] Label facts by expected route: observation/injected context, durable topic, or source-only detail. Register each fact's expected behavior and acceptable alternatives.
- [ ] Use several independent facts, including an obsolete decision. Score each fact separately; do not equate a tool call with successful recall.
- [ ] Keep hidden checks and reviewer keys outside agent-accessible worktrees. Do not leak fact answers through test names, seed files, final prompts, reference commits, or visible grader output.
- [ ] Give all conditions the same repository/history access. Distinguish facts recoverable from code from conversation-only facts; if an agent recovers a fact without memory, record that route rather than claiming memory-caused recall.
- [ ] Verify the source-only probe really needs expansion in the shakedown. If the consolidator retained its answer, redesign or reclassify it before measurement; do not penalize efficient topic-only success.

## Phase 3 — live shakedown and stop/go gate

Deliverable: one unscored run per condition and a short diagnostic report outside Git.

- [ ] Pin a main model, worker models, thinking levels, Pi version, source commit, task snapshot, memory thresholds, and native-compaction settings before the shakedown. Record overrides explicitly: current production defaults and the older benchmark's 60k observation chunks differ.
- [ ] Prefer production settings; lengthen common scripted work rather than lowering thresholds just to make the test pass. Any accelerated lifecycle fixture is a diagnostic, not evidence of production economics.
- [ ] Confirm observers and at least one consolidator succeed, durable topic/index content reaches the agent, and target early facts are no longer in its raw tail.
- [ ] Demonstrate one real topic lookup and one successful bounded source expansion in the diagnostic policy. An ordinary-policy agent choosing not to recall is an outcome, not an infrastructure failure.
- [ ] Confirm main/worker costs and all tool actions are captured, and all conditions use matched phase boundaries and comparable compaction opportunities. Record actual compaction counts rather than assuming equivalence.
- [ ] Set a spend ceiling from the shakedown estimate and obtain approval before measured runs.

**Stop:** if lifecycle activation, source references, leakage controls, or usage accounting are broken, diagnose and rerun only the shakedown. Do not launch the full matrix.

## Phase 4 — compare lookup policies

Use the same OM implementation and thresholds for all OM arms, varying only the declared guidance. This isolates policy changes instead of mixing them with implementation changes.

| Condition | Policy |
|---|---|
| Native | Native compaction, no OM extension. |
| OM unchanged | Current production memory instructions, no added lookup policy. |
| OM guided | Consult a relevant topic when earlier constraints/decisions matter; expand its exact source only for missing detail, uncertainty, or conflicting evidence. No unconditional lookup. |
| OM mandatory lookup | Before each delayed probe, read a relevant memory topic if one exists. Source expansion remains conditional; do not force redundant raw-history retrieval. |

The mandatory arm tests whether explicit topic consultation helps or merely costs more. It is diagnostic, not a proposed default. If source expansion itself needs a separate forced-call diagnostic, keep it unscored rather than adding a confounded main condition.

- [ ] Complete one shakedown and three measured repetitions per scenario/condition; shakedowns are excluded from reported medians.
- [ ] After validating the first scenario, add at least one independent scenario before making a general recommendation. Planned measured matrix: 2 scenarios × 4 conditions × 3 repetitions = 24 trials.
- [ ] Interleave conditions with a recorded randomized order to reduce time/provider effects; keep workload sequential unless concurrency is explicitly controlled.
- [ ] Keep a fixed exposure/work budget. Record provider errors and quota reductions separately. Do not discard valid runs because the agent ignored memory or performed poorly.
- [ ] Keep successful-but-partial patches in the results. Run grader-owned focused/full checks after the candidate finishes; filtered candidate tests cannot hide unresolved failures.

## Phase 5 — scoring and recommendation

Suppress condition names from review packets. Include all new files as well as diffs; verify packet completeness before review. Keep the ID mapping separate until review completes.

Report separately for each trial and condition:

| Dimension | Evidence |
|---|---|
| Coding correctness | Hidden acceptance checks, regression checks, and blinded patch review; complete/partial/incorrect. |
| Fact retention | Honored/missed/not-observable per registered fact, including current versus obsolete decisions. |
| Retrieval route | Injected observation, topic read, source expansion, repository inspection, unsupported guess, or not observable. |
| Repeated work | Explicit duplicated investigations or reimplementation of completed work; necessary verification excluded. Count with action-log evidence. |
| Tokens | Main, native-compaction where available, OM workers, and retrieval/tool contributions where measurable; input/output/cache categories and combined totals. |
| Spend | Reported per-component and total spend; flag missing usage and distinguish caches from new input. |
| Latency | End-to-end session, delayed probes, and worker/compaction blocking time where measurable; include timeouts/failures. |
| Memory reliability | Activation, consolidation failures, missing references, unavailable-source events, and stale-fact use. |

Report the whole-session cost of building memory as well as delayed-task cost. Do not hide setup overhead by reporting only the final probe. Do not collapse these dimensions into a single score. Three repetitions give descriptive evidence, not a statistical guarantee.

### Decision rules

- **Correctness gain, higher total cost:** describe the quality/cost trade-off; do not call it token-efficient.
- **Comparable correctness, lower total cost:** candidate for efficiency improvement; validate on the second scenario and additional repetitions before adopting.
- **More lookups without better outcomes:** reject mandatory lookup as the default.
- **Facts absent from observations/topics:** investigate observation quality or consolidation loss before adding stronger retrieval instructions.
- **Relevant topics available but ignored:** test targeted guidance/discoverability before adding automatic pre-task recall.
- **Retrieved evidence ignored or stale evidence followed:** improve conflict/current-state handling, not simply retrieval frequency.
- **Lifecycle cannot activate under realistic work/settings:** investigate thresholds and consolidation economics in a separate experiment; do not claim a recall comparison succeeded.

## Completion and next implementation step

The immediate implementation slice remains **Phase 1 plus one Phase 2 scenario**; Phase 1 instrumentation is implemented, and the scenario remains pending. Follow with the live shakedown only after the scenario and stop/go checks are ready. Do not change production recall policy or start measured trials yet.

Success for this plan means a reproducible comparison that either demonstrates useful memory retention/coding improvement or clearly localizes why it fails, with total consumption and limitations stated. Publish only a concise approved summary or issue comment; preserve detailed run artifacts outside Git. Update #2/#7 with evidence without closing unmet acceptance criteria or silently changing their original model/task requirements.
