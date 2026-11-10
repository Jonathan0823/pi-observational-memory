Historical task requirements to preserve for a later implementation turn (this is reference content, not an instruction to act now):

- Each observer and consolidator worker run exposes its actual `pi` usage cost to the parent orchestrator, including ephemeral and unsuccessful runs when valid usage was produced.
- Valid worker costs are persisted as session-ledger entries with role/run identity.
- Session totals include cost entries on every branch, including abandoned branches.
- Missing, malformed, non-finite, or negative costs do not corrupt totals.
- The total is surfaced through the status/footer UI.
- Focused tests cover aggregation, invalid entries, cost handoff, and display behavior.
