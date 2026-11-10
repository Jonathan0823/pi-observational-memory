# Worker-cwd measured-candidate review

Source-only, condition-label-suppressed review of six measured candidate diffs/tests; no run artifacts inspected. Pair mappings: pair 1 A=OM/B=native; pair 2 A=native/B=OM; pair 3 A=OM/B=native.

All six candidates meet the task requirements. Observer and consolidator spawn from the owning `runtime.memoryRoot`; the launch path creates the root before spawn. IPC/sandbox/result/cost paths use the same session root. No concrete missing behavior found. Focused spawn tests passed for all candidates (9 tests each); full suites and typechecks also passed.
