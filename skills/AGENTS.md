# AGENTS.md — Causal skills

Three skills live in this directory. Pick one, read it start to finish, then follow it. Do not improvise a fourth path.

## Choosing

| The user wants | Skill |
| --- | --- |
| Tracing added to an existing codebase | `causal-instrument-repo` |
| A first trace, or proof that credentials and connectivity work | `causal-quickstart` |
| To understand and fix something that already broke | `causal-debug-incident` |

Tie-breakers:

- **Credentials unproven?** Run `causal-quickstart` first regardless of the ask. Instrumenting a repo against a key that does not work wastes the whole session.
- **"It's broken" but nothing is instrumented?** There is no trace to debug. Say so, run `causal-instrument-repo`, and reproduce.
- **Genuinely ambiguous?** Ask one question rather than guessing — instrumenting a repo and debugging an incident touch very different files.

## House rules

These apply to all three skills. They override any convenient shortcut a skill body seems to allow.

1. **Tracing is additive.** Wrap call sites; never rewrite the logic inside them. No changed control flow, no reordered awaits, no refactors bundled in. If instrumenting cleanly requires a refactor, propose it separately and leave it to the user.

2. **Fail open when the key is missing.** An app without `CAUSAL_API_KEY` must run exactly as it did before — spans get dropped, a warning is logged at most once, nothing throws. Observability that can take down the thing it observes is worse than no observability. The same holds for a Causal API that is down, slow, or returning errors: swallow it, never block the request path.

3. **Never hardcode secrets.** Keys come from the environment, always. No literals in source, no keys in committed config, no keys echoed into logs, commit messages, or PR bodies. Add `CAUSAL_*` to `.env.example` with empty values and leave the real ones to the user. `causal_demo_key_2026` is public and may appear in docs and local `.env` files — never anywhere that touches production data.

4. **Always attach git context.** Every trace carries repo, branch, and commit SHA; error spans carry file, line, and commit where you can resolve them. This is the whole mechanism by which a failure resolves to a commit instead of a vague time window. Read the values from the checkout at runtime — do not pin them to literals that go stale on the next deploy.

5. **Always verify at the end.** No skill is done because the edits look right. Instrumentation is done when a real run produces a trace you have retrieved and read back. A fix is done when the failure it targets no longer reproduces on the same trace. If you could not verify, say plainly what is unverified and why — never report success on unrun code.
