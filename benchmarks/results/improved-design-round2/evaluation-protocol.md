# Evaluation protocol — improved-design round 2

This protocol is fixed before inspecting round-2 trial outputs. It applies identically to native compaction, current OM, and improved OM. Shakedowns validate the setup and are excluded from outcome summaries; all three measured repetitions are retained unless a documented technical failure invalidates a trial.

## Task completion

For each measured candidate, run the task snapshot's documented acceptance/full test suite from its saved diff and record typecheck/test results separately. A blinded behavior reviewer compares the final patch and interaction transcript with the task specification, assigning: complete, partial, or incorrect, with concrete evidence. No single aggregate score is computed.

## Memory facts

Check the following task-specific fact sets against the final artifact and interaction transcript. Mark each fact honored, missed, or not observable. Report denominators and counts per trial/task. Do not infer these scores from token counts, spend, or latency.

- **Cost ledger:** actual Pi-reported worker usage cost; valid costs include unsuccessful/ephemeral workers when usage exists; ledger records identify worker role/run; aggregation includes every branch; invalid/missing/non-finite/negative cost values do not affect totals; status/footer exposes the total.
- **Session scope:** immutable session-header ID determines the root; parent is discovered through its session path and header ID; child is seeded once and does not overwrite on resume; transient `.runs/` is excluded; missing/unreadable parent memory does not create a child root until durable write; all durable memory and IPC paths use the owning root.
- **Worker cwd:** both worker roles run from the runtime-resolved owning `.memory/<sessionId>/`; the directory exists before spawn; session discovery, IPC and consolidator tools are scoped there; worker model, prompt, environment, result handoff, cancellation, and exit behavior are preserved.

**Attribution caveat:** the final implementation prompts repeat most or all of the facts above. These scores measure whether the behavior is present, not whether it was specifically retrieved from memory. Report this limitation explicitly; do not claim memory-caused recall improvement from this task set.

## Repeated work

Review the anonymized interaction transcript, not runtime or token totals. Count only objectively avoidable duplicated work: (1) broad repository exploration explicitly prohibited by the task before inspecting the relevant files, (2) a baseline/full test run explicitly prohibited before editing, or (3) repeating an implementation/test action after its successful result without a new failure or requirement. Record event counts and examples; classify each trial as none, one, or multiple. Necessary focused inspection and post-edit verification are not repeated work.

## Blinding and reporting

Remove condition names and trial IDs before behavior/repeated-work review; use random candidate labels within each task. Reviewers receive the task specification, final patch, relevant test output, and transcript. Preserve a mapping from anonymous labels to condition separately from the review packet. Report correctness, fact coverage, repeated-work findings, tokens, spend (main and worker separately where available), and latency as separate tables. Do not combine them into a score.
