# Layout-3 migration release notes

Batch B8 builds `terum-skills team migrate`. Shipping this command does not authorize running it.
A human runs it from a terminal only after the release containing B1's auto-share removal has
propagated to teammates (§13.1(b)). It is not an app/frame verb and has no automatic trigger.

The command selects the configured team (`--team <name>` when necessary) and uses one guarded
`safeWrite` commit to move every flat skill's bytes, including eval cases, into `v1`, fold the old
global list into `projects.Global`, re-key matching receipts, archive the others verbatim, and
rewrite all members' installed versions and adopted project references. It preserves executable
modes and unknown JSON fields. The clone's push guard is re-armed; repeating the command on layout
3 creates no migration commit and repairs the hook if its refresh was interrupted.

Malformed member files or current receipts, multiple case variants of Global, duplicate skill
identities, and partially versioned input stop the migration for human repair. Archived receipts
retain their original bytes, and schema-1 receipts acquire no invented content digest (OF-15);
install's treatment of those receipts belongs to B6. Local config and local eval histories are
not migrated by this command. Pending install/uninstall recovery belongs to those verbs, not B8.

The committed GitHub workflow is migration debt: it invokes the latest CLI but cannot be updated
through the product's write guard. Between the first layout-3 release and each team's migration,
its README job refuses layout 2 and exits nonzero. This red interval is expected. The workflow is
left untouched; a human may update it through the existing print-only workflow-update handoff.
Non-GitHub remotes regenerate the README inside the migration commit, with the §13.1(a)
never-empty-catalogue check. Older CLIs must continue rejecting `layout_version: 3`.

This batch was built without running the migration or git. The migration integration tests create
only disposable local bare repositories; they are left for the orchestrator to run.
