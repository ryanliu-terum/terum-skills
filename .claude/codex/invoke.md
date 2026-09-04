# Codex invocation contract

How to call `codex exec` for a **read-only analysis** task — a second, uncorrelated opinion where
Claude's failure mode is confirming its own reading.

This is the shared contract for the analysis surfaces (migration pre-apply read, eval answer-key
audit, adversarial test inputs). It is **not** the contract for `/codex-implement`, which writes
code and owns its own runbook in `.claude/skills/codex-implement/SKILL.md`.

`ultrareview.js`'s `--codex-verify` relay predates this file and is deliberately **not** refactored
onto it — it is calibrated and working. If the two ever disagree, that file is authoritative for
review verification and this one for everything else.

## Why Codex at all

Its measured edge here is **decorrelation, not capability**:

- Verify panel (PR#109): Codex killed **4/5** known-false findings; Claude's 3-vote panel killed **0/5**.
- Cold clarity benchmark, 16 retained questions: Claude **16/16**, Codex **14/16** — and 4 of 32
  Codex answers came from prior knowledge, 2 of those were misses.

So it is *worse* at understanding this repo and *much better* at refusing to agree with Claude.
Spend it on refutation and independent derivation. Do **not** spend it on discovery, search, or
anything that runs on Terum's accumulated priors.

## The call

```bash
codex exec - \
  -C . \
  -s read-only \
  --ephemeral \
  --ignore-user-config \
  -m <model> \
  -c model_reasoning_effort="<effort>" \
  --output-schema .claude/codex/schemas/<task>.json \
  -o "$OUT" \
  < "$PROMPT"
```

| Flag | Why |
| --- | --- |
| `-` / stdin | Prompt from a file. Keeps long rules out of the shell's argv. |
| `-C .` | Working root. **Never** `--add-dir` — widening the readable/writable set defeats the point. |
| `-s read-only` | Analysis never writes. `workspace-write` belongs to `/codex-implement` alone. |
| `--ephemeral` | No session files on disk. These calls are one-shot and must not accumulate state. |
| `--ignore-user-config` | Skips `~/.codex/config.toml`, so a stale `gsd-*` agent registration or a stray `features.*` cannot silently attach to an analysis run. Auth still resolves via `CODEX_HOME`, so this does not log you out. |
| `--output-schema` | Forces a structured verdict instead of prose. An unparseable answer is a failed call, not a soft one. **Every key in `properties` must also appear in `required`** — see below. |
| `-o` | Codex writes **only its final message** to `$OUT`. Read that file, never the transcript — this is the difference between ~500 and ~50,000 tokens of context. |

**Never pass `-a` / `--ask-for-approval`.** It does not exist on `exec` and aborts the run with a
usage dump. **Never pass `--full-auto`** (implies `-a on-request`, which lets the model decide to
ask a human that nothing can answer) or `--dangerously-bypass-approvals-and-sandbox`.

## Models and effort

| Tier | Model | Use |
| --- | --- | --- |
| `sol` | `gpt-5.6-sol` | Default. Anything where a wrong verdict costs real time. |
| `terra` | `gpt-5.6-terra` | Mid. |
| `luna` | `gpt-5.6-luna` | Cheap bulk passes. |

Effort: `low` | `medium` | `high` | `xhigh`. Default `high` for verdict work.

**Effort cannot rescue a vague prompt** — it only lets the model finish analysis it already
understands. A wrong answer caused by an ambiguous rules file gets more confidently wrong at
`xhigh`, not more correct.

CLI floor is **0.145.0** (the GPT-5.6 tiers went GA 2026-07-09). An older CLI silently falls back to
an older model, which looks exactly like it worked.

## The schema trap — every property must be required

`--output-schema` is enforced by OpenAI's structured-output mode, which is **stricter than plain
JSON Schema**: at every object level, `required` must list **every** key in `properties`. There is
no such thing as an optional field.

Get it wrong and the API rejects the request with:

```
invalid_json_schema: 'required' is required to be supplied and to be an array
including every key in properties. Missing '<field>'.
```

Verified 2026-07-31 — and it failed in the worst possible way: the run emitted **no output at all
and still exited 0**, so anything trusting the exit code would have recorded a clean pass. If a
field is genuinely optional, keep it in `required` and let its value be an empty array, an empty
string, or `null` — encode optionality in the value, never in the key.

Sanity check any new schema before first use:

```bash
node -e 'const s=require("./.claude/codex/schemas/<name>.json");
(function walk(n,p){ if(n&&n.type==="object"&&n.properties){
  const miss=Object.keys(n.properties).filter(k=>!(n.required||[]).includes(k));
  if(miss.length) console.log("MISSING in required at",p||"(root)",":",miss.join(", "));
  Object.entries(n.properties).forEach(([k,v])=>walk(v,`${p}.${k}`)); }
  if(n&&n.items) walk(n.items,`${p}[]`); })(s,"");
console.log("schema checked")'
```

## The exit-code trap

**`codex exec` exit codes lie in both directions.** A run that produced a usable verdict can exit
non-zero, and a run that produced nothing can exit 0.

Treat the **emitted JSON as the only evidence**. The pattern:

```bash
codex exec - <flags> -o "$OUT" < "$PROMPT" >/dev/null 2>&1; echo "rc=$?"; cat "$OUT"
```

Read `$OUT`. If it is empty or fails schema validation, the call **failed** regardless of `rc=0`.
If it validates, the call **succeeded** regardless of a non-zero `rc`.

A failed analysis call is an **absent opinion, never a verdict**. Do not let a failure collapse into
"Codex found nothing" — say the call failed and how many calls that was.

## Prompt structure

Every rules file starts by including `.claude/codex/preamble.md`. Codex does **not** auto-load
`CLAUDE.md` or any per-directory instruction file, so the repo's conventions reach it only if the
prompt carries them. Injecting them is what took one measured review pass from 6 false positives
to 1 — this is not boilerplate.

```
<preamble.md>            # who you are, what to read first, this repo's conventions
<task rules>             # .claude/codex/rules/<task>.md — what to judge and how to decide
<the artifact>           # the SQL / the answer key / the contract, inline
```

Keep the artifact inline in the prompt rather than telling Codex to go find it. It reads the repo
worse than Claude does; handing it the exact bytes removes the failure mode where it audits the
wrong file.
