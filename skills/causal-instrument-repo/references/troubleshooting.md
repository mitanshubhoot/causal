# Troubleshooting Causal instrumentation

Work top to bottom: confirm a trace arrives at all, then that it is shaped, anchored, economic and legible.

## Symptom → likely cause → fix

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| No trace appears at all | The traced code never ran — the entry point you wrapped is not the one the request hits | Log inside the `trace()` callback and re-run; if the log is silent, you wrapped the wrong function. Re-do Step 2's entry-point scan |
| No trace, and the wrapper definitely ran | Export failed silently — `trace()` swallows export errors so telemetry never breaks the app | Call `tracer.export(t)` / `await t.flush()` once by hand outside `trace()` and read the thrown error, or run the curl smoke test below |
| Script, CLI or cron job produces nothing | Process exited before the flush | You opened the trace with `startTrace()` / `start_trace()`: `await t.flush()` in a `finally`. Never `process.exit()` / `sys.exit()` before it resolves |
| Serverless function produces nothing intermittently | Handler returned before the export finished; the container froze | `await` the traced run before returning the response. No fire-and-forget, no floating promises |
| `401 Missing Authorization header` | `CAUSAL_API_KEY` unset in the process that runs the agent | Check the running process, not your shell: PM2/systemd/Docker/Vercel each need the var declared. `.env` files are not read unless something loads them |
| `401 Invalid API key` | Typo, quotes captured into the value, or a key from another environment | Re-copy the key; `causal_demo_key_2026` is the public demo key for local trials |
| Ingest returns `400` | Payload rejected: unknown span `kind`, `startedAt` not a date, or over 2000 spans | Use a documented kind, let the SDK set timestamps, and reduce span count (span the loop, not each iteration) |
| Traces land nowhere you can see them | `CAUSAL_API_URL` still points at `http://localhost:3001`, or `CAUSAL_ORG_ID` is another org | Set the hosted URL and the org id explicitly for that environment, then re-run and check the traces list |
| `fetch failed` / `ECONNREFUSED` | Causal API not running, or unreachable from a container | Start the API, or use the host-reachable URL from inside the container (not `localhost`) |
| Spans are sparse — one root span and nothing else | Only the entry point was wrapped | Add spans at the boundaries: every model call, every tool, every graph node, every retrieval |
| All spans are siblings; the trace is flat | Children created with `t.span()` instead of `parent.child()` | `t.span()` opens a span in the run; `parent.child()` nests. Nest tools under the llm span that chose them |
| Durations are `0` | `end()` called immediately after opening the span, or never called | Open the span before the work, end it after. In `finally` blocks, end once — the first `end()` wins in TS; in Python do not call `end()` twice |
| A failed run shows every span green | `end()` called without `status`/`error` in the `except`/`catch` branch | End error paths with `status: "error"` and a real message (`f"{type(exc).__name__}: {exc}"`), then re-raise |
| **RCA is weak: "something failed somewhere"** | Failing spans carry no `git` context | Attach `git: {file, line, commit}` to every span running your code. This is what makes root-causing possible |
| Git context present but blames nothing | `commit` is `"unknown"`, or paths are absolute / point into `dist/` and `build/` | Resolve HEAD once at boot; in images without `.git`, set `CAUSAL_GIT_COMMIT` at build time. Paths must be repo-relative source paths |
| Tokens and cost are zero | Usage never added to the trace | `t.tokensIn/tokensOut/cost` (`t.tokens_in/tokens_out/cost` in Python) on every model call, read from the provider response |
| Trace shows up seconds after the run | Normal: the export is one request at the end of the run, and detectors run after ingest | Wait a few seconds and refresh. If it never lands, it is an export failure, not a delay |
| Duplicate traces for one request | The entry point is wrapped twice — middleware plus handler, or a second tracer added next to an existing one | One `trace()` per run. Grep for `CausalTracer` and keep exactly one config module |
| Trace has no user or session | Identity attached to a process-wide tracer with no request context | Derive a request-scoped tracer from the shared config (`tracerFor` / `tracer_for`) with `user` and `sessionId` |

### Curl smoke test

Proves key, URL and network in one shot — expect `201`:

```bash
curl -i -X POST "${CAUSAL_API_URL:-http://localhost:3001}/api/v1/traces" \
  -H "authorization: Bearer $CAUSAL_API_KEY" \
  -H "content-type: application/json" \
  -d '{"traceId":"smoke-'"$RANDOM"'","service":"smoke-test","spans":[
        {"id":"s1","parentId":null,"name":"smoke","kind":"agent","startMs":0,"durationMs":1,"status":"ok"}]}'
```

`401` ⇒ key problem. `400` ⇒ payload problem. Connection refused ⇒ URL or network. `201` ⇒ the transport is fine and the bug is in your instrumentation.

## Localizing a failure

Once traces arrive, use them:

1. **Open the failing run** and find the first span with `status: "error"` — the deepest one, not the root. Ancestors fail because their child failed.
2. **Read its `error` string.** A real exception message (`KeyError: 'change'`) localizes instantly; `"failed"` or `"false"` tells you the instrumentation is lazy — fix the string and re-run.
3. **Read its `git` context.** `{file, line, commit}` is the blame target:
   ```bash
   git show <commit> --stat -- <file>      # what shipped in that commit
   git log -L <line>,<line>:<file>         # how that line got there
   git blame -L <line>,<line> <file>
   ```
4. **No `git` on the failing span?** That is the bug to fix first. Add it at the failing call site, re-run the scenario, and root-cause from the new trace — a run without git context cannot be traced back to a commit or turned into a fix PR.
5. **Error in an `llm` or `http` span** — the failure is the provider's: read `io.output` and the status attribute, then check whether your code handled the bad response. The handler is where `git` belongs.
6. **Failure with no error span at all** — the agent returned a wrong answer, not an exception. Read `io.input`/`io.output` down the chain and mark the first span whose output is wrong with `status: "warn"` so the next run makes it obvious.
