# Frame mode: driving terum-skills from a program

`terum-skills --frames <verb> [options]` runs any verb with a program, not a person, on the other end. Every line the CLI writes to stdout is one JSON object (a frame); every line it reads from stdin is one JSON object. Nothing else is on stdout. Diagnostics about the channel itself go to stderr. Without `--frames`, nothing changes.

This is the Prompter serialised (`src/lib/prompt.ts`): the CLI already funnels every question it asks a human through one interface, and frame mode is a second implementation of that interface (`src/lib/frames.ts`). Verbs do not know which one they have. The desktop app's `src/backend/tauri/` speaks this protocol; so can a script.

The flag is position-independent before the first `--` (`--frames status` and `status --frames` are the same) and is removed before the verb's own options are parsed.

## Frames the CLI writes (stdout)

One per line, in this order: `hello` once, then any number of `print` and `ask`, then exactly one `result`, including on a usage error.

| Frame | Shape | Meaning |
|---|---|---|
| `hello` | `{"t":"hello","protocol":1,"version":"0.1.5","verbs":[...],"features":{...}}` | Always first. `verbs` is every public verb as it may be invoked. `features` maps drawn affordances the desktop design assumes to whether this CLI version supports them; a `false` means hide or grey the control. Read it instead of hard-coding what the CLI can do. |
| `print` | `{"t":"print","level":"info"\|"warn"\|"error","line":"..."}` | Text the verb would have printed. Render it where the verb's output belongs. |
| `ask` | `{"t":"ask","id":"q1","kind":"confirm"\|"text"\|"select","question":"...","default":"...","choices":[...],"detail":["..."]}` | The verb is blocked until an `answer` with the same `id` arrives. `default` appears only for `text` when the verb offers one; `choices` only for `select`. `detail` is optional and carries the lines the person needs in order to answer (for example the identity line, or a skill's requested allowed-tools); render it with the question, as the dialog's description, not in the transcript; absent means none. |
| `progress` | `{"t":"progress","step":"...","current":n,"total":n}` | Reserved. No verb emits progress today (`features.progress` is `false`); the shape is fixed so a shell can render it when one does. |
| `result` | `{"t":"result","verb":"install","ok":true,"exitCode":0,"value":{...}}` | Always last. `verb` is the invoked verb. `value` is the verb's own result object when it has one. On failure: `ok:false`, `exitCode:1`, `error` is the one-line message, and `declined:true` when set by the CLI's typed decline (the person said no) rather than by matching the error text, and `refused:true` when the CLI refused the operation before any side effect (one team per machine); a refusal is not a decline. After `result` the CLI stops reading stdin and exits. |

The process exit code matches `result.exitCode`. The failure line is also written to stderr, exactly as without the flag, so a shell that only watches the exit code and stderr still works.

## Frames the shell writes (stdin)

| Frame | Shape | Meaning |
|---|---|---|
| `answer` | `{"t":"answer","id":"q1","value":...}` | Answers the `ask` with that `id`. For `confirm`: a boolean, or one of `y`, `yes`, `true` (anything else is no). For `text`: a string; empty means take the default. For `select`: the 1-based index as a number, or the exact choice string. An invalid `select` answer gets a `print` warn frame and the same question is asked again with a new `id`, up to three times, then the verb fails. |
| `cancel` | `{"t":"cancel"}` | Abandons the run. Every pending question fails closed, the verb throws, and the run ends in a `result` with `ok:false`. |

Closing stdin behaves like `cancel`. Malformed lines and answers to unknown ids are reported on stderr and ignored; they never disturb a pending question.

## Rules a shell must follow

1. **The `gh auth login` offer never arrives over frames.** When `gh` is installed but logged out, the CLI in frame mode prints `GitHub CLI is installed but logged out. Run \`gh auth login\` in a terminal, then try again.` instead of asking (it would otherwise hand its stdio to `gh`, which here means the frame pipes). Likewise `setup` never asks the desktop-app opt-in question over frames. If a shell ever does see that confirm, the CLI is older than 0.1.6: answer `false`.
2. **Never use `sync --hook` over frames.** Its stdout is the Claude Code reload directive, not frames; the CLI refuses it with a `result` frame and exit 1. Call plain `sync`.
3. **Never ask the CLI for `--help` or `--version` in frame mode.** Commander prints those as text.
4. **Set `cwd` deliberately.** Project-scoped skills exist only relative to the working directory the CLI is started in; a shell passes the chosen workspace as the child's cwd. For reads (`ls --local`), `cwd` is a suggestion: the detected cwd repository is reported as not registered, and registered checkouts are listed regardless of `cwd`.
5. **One run per verb.** Start the process, read frames until `result`, let it exit.

## Example

```
$ printf '' | terum-skills --frames status
{"t":"hello","protocol":1,"version":"0.1.5","verbs":["login","setup",...],"features":{"favorites":false,...}}
{"t":"print","level":"info","line":"terum-skills 0.1.5"}
{"t":"print","level":"info","line":"Get started:"}
...
{"t":"result","verb":"status","ok":true,"exitCode":0,"value":{"version":"0.1.5","teams":[]}}
```

A `connect` that asks:

```
> {"t":"ask","id":"q1","kind":"select","question":"Which skill?","choices":["diagnose (global)","tdd (project)"]}
< {"t":"answer","id":"q1","value":2}
> {"t":"ask","id":"q2","kind":"confirm","question":"Connect tdd to team terum? Adds license, id and author to its SKILL.md."}
< {"t":"answer","id":"q2","value":false}
> {"t":"result","verb":"connect","ok":false,"exitCode":1,"error":"Connect was declined.","declined":true}
```

A second-team binding refused before any side effect:

```json
{"t":"result","verb":"setup","ok":false,"exitCode":1,"error":"One team per machine: …","refused":true}
```

## Versioning

Protocol stays 1. `hello.features.localIdentity` advertises the additive `ls --local` identity fields: every row and `notOffered` entry carries `skillId` (UUID or null), and every row carries independent `placed` and `connected` booleans. The app declares these keys optional while keeping local rows strict, so older CLIs remain readable; presence joins require the feature. `ls member` adds `member.installed` records (`id`, `scope`, `since`), and `connect` may return `adopted: true` after consent to record an existing identity. These are additive result fields.

`hello.features` names `favorites`, `follow`, `roles`, `lastSeen`, `installScope`, `inviteScoping`, `disablePerMachine`, `projectMembers`, `liftOnCards`, `runEvalInApp`, `perCase`, `progress`, `memberRole`, `localIdentity`, and `checkouts`. `memberRole` is the owner-written job label and is true; `roles` is the Admin/Member permission chip and remains false. `checkouts` is true and means the `checkout add`, `checkout remove`, and `checkout list` verbs and the `registered`/`detected` section fields exist.

`hello.protocol` is `1`. `detail` is an additive optional field: protocol stays 1. Additive changes (new optional fields, new `features` keys, a verb starting to emit `progress`) do not bump it. A change that alters the meaning of an existing field does.
