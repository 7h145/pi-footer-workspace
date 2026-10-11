# pi-footer-workspace

Shows where work needs attention across a workspace's Git repositories.
The footer gives a compact summary; `/workspace` opens a read-only overview
with branch, working-tree and locally known upstream status.

This is useful when Pi runs in an outer development repository and the products
live in separate repositories underneath it. Product repositories are discovered
even if the outer repository ignores them. The extension also retains a small
`(ro)` marker for a working directory that cannot be written to, such as a
read-only container mount.

## Installation and first use

Requires **Pi 1.0.2 or newer** and Git on `PATH`.

```bash
pi install git:github.com/7h145/pi-footer-workspace
```

This installs for your user. Add `-l` for a project-local installation. Run
`/reload` after installing or updating while Pi is running, then run:

```text
/workspace
```

The view lists discovered repositories. Use **↑/↓** or **j/k** to select one,
**Enter** to see its path and changed files, and **Esc** or **q** to go back or
close. **PgUp/PgDn** move through longer lists; **n** opens workspace notices,
including discovery and writability errors. Details and notices wrap long lines
and can be scrolled.

To try a local checkout without installing, run from its root:

```bash
pi --no-extensions -e .
```

This loads only the checkout's extension, without duplicate installed copies.

### Optional first-line footer placement

Install and enable
[`pi-footer-compositor`](https://github.com/7h145/pi-footer-compositor)
to place the summary on the first footer line:

```bash
pi install git:github.com/7h145/pi-footer-compositor
```

The compositor is not installed automatically. Without it, Pi shows the same
values on its ordinary extension-status line. This extension uses only Pi's
public status API and does not patch or replace the footer.

## Workspace scope

By default, the workspace root is the Git worktree containing Pi's working
directory. If there is no containing worktree, it is the working directory
itself. Discovery includes:

- the worktree containing that root, if any;
- Git worktrees in the root's **immediate child directories**.

It does not recursively crawl deeper directories or follow child-directory
symlinks automatically. Linked worktrees and submodules with a `.git` file are
recognized. Different linked worktrees remain separate; aliases to the same
worktree are counted once. Bare repositories are not working trees and are not
included.

Starting Pi inside a product scopes the overview to that product, not to its
siblings. To keep the larger workspace visible, specify its root:

```bash
cd /stage/product
pi --workspace-root /stage
```

The flag is registered by this extension, so the extension must be loaded.
Relative flag paths resolve against Pi's startup working directory.

### Include or exclude repositories

Create `.pi/workspace.json` under the chosen workspace root:

```json
{
  "include": ["components/service", "../shared-library"],
  "exclude": ["archived-product"]
}
```

Paths are relative to that root unless absolute. They identify exact worktree
roots, not glob patterns. Includes can opt into deeper paths, symlinked paths or
repositories outside the root. Exclusions override both automatic discovery and
includes. If the root is a worktree, excluding `"."` removes it but leaves its
products.

The file is optional; both lists default to empty. Unknown settings, invalid
JSON and invalid path lists are reported rather than silently ignored. A missing
or invalid included repository is a discovery notice. Run `/workspace` after
changing the configuration or adding/removing a repository.

## Footer summary

Examples:

```text
git 6 clean
git 2/6 dirty
git 2/6 dirty, 1 unknown
```

The denominator is the number of identified worktrees, including the outer
repository unless excluded. “Dirty” means at least one changed or untracked
path. “Unknown” means a known repository's current status could not be obtained;
it is never assumed clean.

`scope ?` means discovery was incomplete, so the identified repositories may
not cover the configured workspace. If no roots could be identified, the footer
shows `git scope ?`. With no repositories and no discovery errors, no Git
segment is shown.

Clean summaries use Pi's success color, dirty or unknown summaries use its
warning color, and a repository with conflicts makes the summary use its error
color. A trailing `?`, such as `git 6 clean?`, means the snapshot is at least
one minute old. Theme styling and snapshot age are checked once per second,
without additional Git requests.

The `(ro)` marker describes **Pi's working directory**, not the workspace root
selected by the flag and not every product mount. It is checked at startup, when
the working directory changes and on manual refresh. The probe briefly creates
and removes a unique file there. Permission/read-only failures show `(ro)`;
other probe failures and cleanup failures appear in workspace notices.

## Inspecting repositories

`/workspace` refreshes discovery, Git status and writability before opening a
snapshot. It waits for its own refresh, including when another scan is running.
The view does not update underneath you; close and reopen it for a new snapshot.

The overview shows repository names, branches, working-tree state and upstream
state. Select a repository for its full path and changes. A path changed in both
the index and worktree counts once; untracked files are counted individually,
including files beneath untracked directories. The extension explicitly requests
untracked files even if `status.showUntrackedFiles` hides them in ordinary
`git status` output. Ignored files remain ignored.

Changed-file details show Git's two status columns: **index / worktree**.
`.` means unchanged, `?` untracked, `M` modified, `A` added, `D` deleted,
`R` renamed, `C` copied, `T` type changed, and `U` unmerged. Rename details
also show the original path. Control characters in paths are escaped for display.

You can open one repository directly using its displayed name or full path:

```text
/workspace product
```

Ahead/behind counts use **local tracking refs**. The extension does not fetch,
so “up to date” is not a claim about the remote's present state. No upstream
is shown as `—`; unavailable counts or Git failures are shown explicitly.

The older command remains available:

```text
/footer-workspace-refresh
```

It performs the same refresh and reports a textual overview without opening
the interactive view.

## Refresh behavior and limits

In TUI mode, known repositories are refreshed every 15 seconds while Pi is
idle. File-changing built-in tools, `codemode` and the settled-agent event
schedule a refresh after a 500 ms debounce. Ordinary read-tool results do not.
Discovery is repeated at startup and on manual commands, not on every poll.

At most two repository status requests run concurrently. Git requests have a
two-second waiting deadline; interrupted, failed or malformed results are not
presented as clean. Background failures do not produce repeated notifications.
Each session owns its queue and cached data. Shutdown, replacement and reload
abort pending Git requests, release waiting commands and suppress late output.
A pending filesystem probe can still finish its cleanup afterward.

Filesystem operations are subject to the filesystem's own responsiveness; the
Git deadline is not a deadline for the entire workspace refresh. Large worktrees
and many untracked files can make scans expensive. Discovery notices, Git
failures and stale snapshots remain visible rather than implying a complete,
fresh result.

RPC mode supports manual commands through notifications: `/workspace` returns
a textual overview and `/workspace product` returns details. It performs no
automatic polling and publishes no footer status. Print and JSON modes reject
commands before scanning because their UI output would not be visible.

All Git commands inspect local state with optional index updates disabled.
The extension does not stage, commit, switch, push or fetch, does not send
workspace data to a model, and does not read changed-file contents or diffs. The only
working-directory write is its temporary writability probe. It also reads the
optional configuration file.

## Migrating from pi-assorted

If the legacy [`pi-assorted`](https://github.com/7h145/pi-assorted) collection is
installed, disable its workspace extension before installing this standalone
version to avoid duplicate registration.

Run `pi config` in a terminal. Under the collection's Extensions entries,
uncheck `pi-footer-workspace/pi-footer-workspace.ts` with Space. Changes are
saved immediately; Esc closes the dialog. For a project-local collection, use
`pi config -l` from that project and select `[-]` (project unload).

If installing the compositor separately, also disable its
`pi-footer-compositor/pi-footer-compositor.ts` collection entry. Do not run the
older standalone `footer-status.ts` patch alongside the compositor.

See Pi's [resource settings reference](https://pi.dev/docs/latest/settings#resources)
for details.

## Development

Use Node.js 24 or newer:

```bash
npm ci
npm run check
```

`check` runs strict TypeScript checks and Node's regression tests. Tests use
disposable local Git repositories and synthetic failures; they do not fetch or
contact a model provider.

The entry point registers flags, commands and lifecycle hooks. `src/discovery.ts`
owns workspace scope and configuration, `src/git.ts` collects and parses Git
status, `src/session.ts` owns requests and cancellation, and `src/view.ts` renders
the read-only snapshot. `src/probe.ts` limits cleanup to probes it created.
