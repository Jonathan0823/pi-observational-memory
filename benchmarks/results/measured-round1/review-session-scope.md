# Session-scope measured-candidate review

Source-only review of six measured candidate diffs/tests; no run artifacts inspected. Pair labels were condition-suppressed during review. Mappings: pair 1 A=native/B=OM; pair 2 A=OM/B=native; pair 3 A=native/B=OM.

| Trial | Review |
|---|---|
| Native r1 (pair 1 A) | Session-scoped reads and worker paths use the session ID; `.runs` is excluded. Caveat: first-line parsing accepts any JSON with string `id` and `cwd`, without requiring a session header type. |
| OM r1 (pair 1 B) | Session startup/fork copy and `.runs` exclusion are present. Caveat: parent-header parser checks ID/cwd but not the header type. |
| OM r2 (pair 2 A) | Resolves owner ID from header, validates parent header, excludes `.runs`, and does not reseed an existing child. No concrete requirement gap found. |
| Native r2 (pair 2 B) | **Fail:** `.split("\\n", 1)` splits on a literal backslash-n rather than a newline, preventing normal multi-line parent session parsing and fork seeding. Parent root is also resolved under current cwd rather than parent header cwd. The test uses a one-line fixture and misses this. (`src/memory/paths.ts:35`, `tests/memory.session.test.ts:23–25`) |
| Native r3 (pair 3 A) | **Fail:** same literal-backslash split prevents normal multi-line parent parsing/fork seeding. (`src/memory/paths.ts:43`) |
| OM r3 (pair 3 B) | **Fail:** same literal-backslash split prevents normal multi-line parent parsing/fork seeding. (`src/memory/paths.ts:37`) |

All six measured candidates passed typecheck and full test suites. Tests did not catch the multi-line-header defects. This is a source review, not a runtime integration test.
