# S7d review notes / PR body

Typed CLI cancellation now travels through Result and the frames channel to both desktop backend outcomes. Commander usage errors terminate with one result frame, while successful help/version retain their text output. Mode scans stop at `--`, and desktop positional arguments follow flags and `--`.

CP-35: the existing Remove dialog already says `Remove <name>?` and contains the corrected copy. Until S7g/S7k supply placement data, it names no scope rather than a wrong one. `ledgerScopes` is exported without changing its body; the union still includes people-only scopes and filters placements by both team and skill ID.

The `FRAME_FEATURES` map and protocol 1 are unchanged; its test now pins the entire map (D13). `roles` remains false. CLI `sync --prune` decline remains success-path data; the mock now agrees and prints `Prune cancelled; nothing deleted.`. Connect picker batch declines remain batch data; explicit-path connect preserves CancelledError through ConnectStepError.

Open questions:
- BM-06 says to exclude COMMANDER_NON_ERRORS but also explicitly requires commander.help with exit 1 to produce a result. The exit-code correction wins: the exemption applies to exit 0 only.
- `useWorkflow` has no shared neutral message surface. Pending a display-location decision, it closes the URL dialog, clears error styling, and retains the exact CLI line in `notice` state. No new toast geometry was invented; callers do not yet render that state.
- GAPS.md's typed-decline clause is closed by this batch. GAPS.md remains maintainer-owned and untouched.

Evidence: frames/ contains rebuilt status, ls, ls --local, ls member mira, ls project terum, search, usage-error, and explicit-path connect decline recordings. The usage-error invocation was `--frames install -x`; connect's confirm was answered false on stdin. Both exited 1 with one terminal result; only the latter has declined:true. fixture.sh reproduces the scratch team; the scratch fx directory was removed after recording. Connect's preflight used the local bare repo instead of the fixture's display-only GitHub URL. All git commands were limited to the scratch fixture, with no network.

No Playwright was run, as instructed. No commits, pushes, installs, protected-file edits, or repository git commands were performed.

## Final verification

- Root lint and typecheck: exit 0.
- Root full `npm test -- --maxWorkers=4`: 73 files passed, 1167 tests passed (200.23 seconds).
- Root `npm run build`: exit 0, canonical wrapper bundled.
- Desktop typecheck and lint: exit 0.
- Desktop `NODE_OPTIONS=--no-experimental-webstorage npm test -- --maxWorkers=1`: 46 files passed, 558 tests passed, 88 design-oracle tests skipped (646 total, 260.50 seconds).
- Isolated protocol suite: 30/30 passed; complete built-bin suite: 23/23 passed; final affected root suites: 45/45 passed.

Earlier runs exposed expected-contract assertions and timing issues; no failing assertion was removed or broadened. The unrestricted desktop run was 542 passed / 16 failed / 88 skipped; a later two-worker run was 557 passed / 1 Dialog timeout / 88 skipped. That unchanged Dialog test passed alone and in the final serial suite. The first full root run was 1164 passed / 3 failed; its three fixtures were updated narrowly: the declining frames-cli stub now uses cancelled(), uninstallMachine expects cancelled:true only for a user decline, and the exact invocation literal catalog tracks the typed uninstall line plus the mandated protocol verb fallback. The tripwire implementation was unchanged. A targeted rerun initially exposed that ScriptedPrompter consumes its answers array; capturing the decline case before invocation fixed the assertion. All final gates above passed.

The new framed help/version bin tests close stdin explicitly, matching the documented printf-empty fixture invocation. Initial CLI runs with open test stdin were interrupted. Final test worker limits avoided unrestricted resource contention without relaxing assertions or timeouts. No pre-change baseline was independently established.

Implementation status remains partial solely because the neutral cancellation line is retained in useWorkflow.notice but has no specified, implemented display location. The dialog closes and no error is painted; the display question remains pending.
