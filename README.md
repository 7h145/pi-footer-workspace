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

## Dependency on pi-footer-compositor

For first-line placement, install and enable
[`pi-footer-compositor`](../pi-footer-compositor/). The compositor relocates the
workspace statuses into its left and right slots:

```text
/stage (ro)                                             3 changes
↑278k ↓19k ...                               gpt-5.6-sol • medium
```

Pi does not currently have a manifest mechanism for extension-to-extension
activation dependencies. Consequently this is an **optional, gracefully
degraded dependency**: without `pi-footer-compositor`, the extension still
works, but Pi displays its values on the ordinary extension-status line instead.
Installing the complete `pi-assorted` package loads both extensions.

Unlike the older standalone `footer-status.ts`, this extension does not patch
Pi's footer. Do not run that old extension alongside `pi-footer-compositor`.

## Installation

Install the complete package:

```bash
pi install git:github.com/7h145/pi-assorted
```

Or load both files directly from the repository root:

```bash
pi \
  -e ./extensions/pi-footer-compositor/pi-footer-compositor.ts \
  -e ./extensions/pi-footer-workspace/pi-footer-workspace.ts
```

If `pi-assorted` is already installed, disable the installed copies with
`pi config`, or add `--no-extensions` for an isolated run.

Last verified with Pi 0.80.6.
