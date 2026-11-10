Reference task requirements for a later implementation turn; this is context, not an instruction to act yet.

Workers are ordinary headless Pi sessions launched by the master. After durable memory is session-scoped, each observer and consolidator must run with the owning session's `.memory/<sessionId>/` root as its working directory, rather than the shared project root. This keeps worker-session discovery separate from ordinary project sessions and scopes transient result/cost IPC and consolidator filesystem tools to that session.

Use the root already resolved by the runtime; do not derive it from a display name or project cwd. Ensure the directory exists before spawning, including for a fresh session with no durable files yet. Preserve worker model, prompt, environment, result handoff, cancellation, and exit handling.
