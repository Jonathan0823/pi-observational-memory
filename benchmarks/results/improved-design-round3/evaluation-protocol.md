# Evaluation protocol — improved-design round 3

This protocol reuses the preregistered round-2 rubric and applies identically to native compaction, current OM, and improved OM. Shakedowns are excluded from outcome summaries; each condition has three measured repetitions.

## Task completion

For each measured candidate, record the final focused acceptance-test and typecheck outcomes from its saved RPC transcript. A blinded behavior reviewer compares the final patch and action log with the task specification, assigning complete, partial, or incorrect with concrete evidence. No aggregate score is computed.

## Memory facts

Check the task-specific fact sets against the final artifact and interaction transcript. Mark each fact honored, missed, or not observable; report counts and denominators per trial/task. Do not infer these scores from token counts, spend, or latency.

- **Cost ledger:** actual Pi-reported worker usage cost; valid costs include unsuccessful/ephemeral workers when usage exists; ledger records identify worker role/run; aggregation includes every branch; invalid/missing/non-finite/negative values do not affect totals; status/footer exposes the total.
- **Session scope:** immutable session-header ID determines the root; parent is discovered through its session path and header ID; child is seeded once and does not overwrite on resume; transient `.runs/` is excluded; missing/unreadable parent memory does not create a child root until durable write; all durable memory and IPC paths use the owning root.
- **Worker cwd:** both worker roles run from the runtime-resolved owning `.memory/<sessionId>/`; the directory exists before spawn; session discovery, IPC, and consolidator tools are scoped there; worker model, prompt, environment, result handoff, cancellation, and exit behavior are preserved.

**Attribution caveat:** the final implementation prompts repeat most or all of the facts above. These scores measure behavior coverage, not whether a fact was retrieved from memory. Do not claim memory-caused recall improvement.

## Repeated work

Review the anonymized action log, not runtime or token totals. Count only objectively avoidable duplicated work: (1) broad repository exploration explicitly prohibited by the task before inspecting relevant files, (2) a baseline/full test run explicitly prohibited before editing, or (3) repeating an implementation/test action after its successful result without a new failure or requirement. Record events and examples; classify none, one, or multiple. Necessary focused inspection and post-edit verification are not repeated work.

## Blinding and reporting

Condition names and trial IDs are removed before review; candidates receive random labels within each task. Reviewers receive the task specification, final patch/new files, check outcomes, and action log. Keep the condition mapping separate from review packets. Report correctness, fact coverage, repeated-work findings, tokens, main/worker spend, and latency as separate measures. Do not combine them into a score.
