# pi-footer-workspace

Publishes compact Git and workspace writability information in Pi's footer:

- `(ro)` when the current working directory is not writable;
- `clean`, `1 change`, or `N changes` for a Git worktree.

In TUI mode, Git status refreshes every five seconds and on input, tool results,
and turn completion. Writability is probed at session startup, when the working
directory changes, and on manual refresh. The probe briefly creates and removes
a uniquely named file in the working directory. Outside a Git worktree, no Git
segment is published.

Force an immediate refresh with:

```text
/footer-workspace-refresh
```

## Optional pi-footer-compositor integration

For first-line placement, install and enable
[`pi-footer-compositor`](https://github.com/7h145/pi-footer-compositor).
The compositor relocates the workspace statuses into its left and right slots:

```text
/stage (ro)                                             3 changes
↑278k ↓19k ...                               gpt-5.6-sol • medium
```

The compositor is optional and is not installed automatically. Without it,
the extension still works, but Pi displays its values on the ordinary
extension-status line instead.

Unlike the older standalone `footer-status.ts`, this extension does not patch
Pi's footer. Do not run that old extension alongside `pi-footer-compositor`.

## Installation

Install this extension from GitHub:

```bash
pi install git:github.com/7h145/pi-footer-workspace
```

For first-line footer placement, also install the optional compositor:

```bash
pi install git:github.com/7h145/pi-footer-compositor
```

These are personal/global installs. Add `-l` to each command for project-local
installs. Run `/reload` after installing or updating while Pi is running.

If you already use these extensions through `pi-assorted`, disable those copies
with `pi config` before installing the standalone packages.

To try a local checkout without installing, run from its root:

```bash
pi --no-extensions -e .
```

This loads only the checkout's extension, without the optional compositor or
duplicate installed copies.

Last verified with Pi 0.80.6.
