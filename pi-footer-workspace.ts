/** pi-footer-workspace
 *
 * Purpose: publish compact workspace status: `(ro)` when the current directory
 * is not writable and `clean`, `1 change`, or `N changes` for a Git worktree.
 *
 * Strategy: probe writability when the working directory changes and refresh
 * Git status every five seconds plus after relevant Pi activity. Publish only
 * through `ctx.ui.setStatus()` using pi-footer-compositor keys; without the
 * compositor, Pi displays the values on its ordinary extension-status line.
 *
 * Author: thias <github.attic@typedef.net>, OpenAI Codex (5.6)
 * License: MIT
 * Version: 0.1
 * Date: 2026-07-16
 * Last verified with Pi: 0.80.6
 */

import { type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { promises as fs } from "node:fs";
import * as path from "node:path";

const GIT_REFRESH_INTERVAL_MS = 5_000;
const LEFT_READ_ONLY_KEY = "footer-compositor:left:10:workspace-read-only";
const RIGHT_GIT_KEY = "footer-compositor:right:10:workspace-git";
const REFRESH_COMMAND = "footer-workspace-refresh";

type RefreshOptions = { forceReadOnly?: boolean };

export default function footerWorkspace(pi: ExtensionAPI) {
	let gitRefreshInterval: ReturnType<typeof setInterval> | undefined;
	let latestCtx: ExtensionContext | undefined;
	let sessionActive = false;
	let sessionEpoch = 0;

	let gitChangeCount: number | undefined;
	let cwdReadOnly: boolean | undefined;
	let cwdReadOnlyCheckedPath: string | undefined;
	const publishedStatuses = new Map<string, string | undefined>();

	let refreshInFlight = false;
	let queuedRefreshCtx: ExtensionContext | undefined;
	let queuedRefreshNeedsReadOnly = false;

	function setStatusIfChanged(ctx: ExtensionContext, key: string, value: string | undefined): void {
		if (publishedStatuses.has(key) && publishedStatuses.get(key) === value) return;
		publishedStatuses.set(key, value);
		ctx.ui.setStatus(key, value);
	}

	function publish(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui" || !sessionActive) return;

		const readOnlyText = cwdReadOnly ? ctx.ui.theme.fg("warning", "(ro)") : undefined;
		setStatusIfChanged(ctx, LEFT_READ_ONLY_KEY, readOnlyText);

		if (gitChangeCount === undefined) {
			setStatusIfChanged(ctx, RIGHT_GIT_KEY, undefined);
			return;
		}

		const text = gitChangeCount === 0 ? "clean" : `${gitChangeCount} change${gitChangeCount === 1 ? "" : "s"}`;
		setStatusIfChanged(
			ctx,
			RIGHT_GIT_KEY,
			gitChangeCount === 0 ? ctx.ui.theme.fg("success", text) : ctx.ui.theme.fg("warning", text),
		);
	}

	async function getGitChangeCount(ctx: ExtensionContext): Promise<number | undefined> {
		const result = await pi.exec("git", ["-C", ctx.cwd, "status", "--porcelain"], { timeout: 2_000 });
		if (result.code !== 0) return undefined;

		return result.stdout
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean).length;
	}

	async function isPathReadOnly(directory: string): Promise<boolean> {
		const probePath = path.join(
			directory,
			`.pi-write-probe-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);

		let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
		try {
			handle = await fs.open(probePath, "wx");
			return false;
		} catch {
			return true;
		} finally {
			await handle?.close().catch(() => undefined);
			await fs.unlink(probePath).catch(() => undefined);
		}
	}

	function shouldRefreshReadOnly(ctx: ExtensionContext, options: RefreshOptions): boolean {
		return options.forceReadOnly === true || cwdReadOnlyCheckedPath !== ctx.cwd;
	}

	async function refresh(ctx: ExtensionContext, options: RefreshOptions = {}): Promise<void> {
		if (ctx.mode !== "tui" || !sessionActive) return;
		latestCtx = ctx;
		const refreshReadOnly = shouldRefreshReadOnly(ctx, options);

		if (refreshInFlight) {
			queuedRefreshCtx = ctx;
			queuedRefreshNeedsReadOnly ||= refreshReadOnly;
			return;
		}

		const refreshEpoch = sessionEpoch;
		refreshInFlight = true;
		try {
			gitChangeCount = await getGitChangeCount(ctx);
			if (!sessionActive || refreshEpoch !== sessionEpoch) return;

			if (refreshReadOnly) {
				cwdReadOnly = await isPathReadOnly(ctx.cwd);
				if (!sessionActive || refreshEpoch !== sessionEpoch) return;
				cwdReadOnlyCheckedPath = ctx.cwd;
			}

			publish(ctx);
		} finally {
			refreshInFlight = false;
			if (sessionActive && refreshEpoch === sessionEpoch && queuedRefreshCtx) {
				const rerunCtx = queuedRefreshCtx;
				const forceReadOnly = queuedRefreshNeedsReadOnly;
				queuedRefreshCtx = undefined;
				queuedRefreshNeedsReadOnly = false;
				void refresh(rerunCtx, { forceReadOnly });
			} else {
				queuedRefreshCtx = undefined;
				queuedRefreshNeedsReadOnly = false;
			}
		}
	}

	function startRefreshTimer(ctx: ExtensionContext): void {
		if (gitRefreshInterval) clearInterval(gitRefreshInterval);
		gitRefreshInterval = setInterval(() => {
			if (latestCtx) void refresh(latestCtx);
		}, GIT_REFRESH_INTERVAL_MS);
		gitRefreshInterval.unref();
		void refresh(ctx, { forceReadOnly: true });
	}

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		sessionActive = true;
		sessionEpoch++;
		latestCtx = ctx;
		startRefreshTimer(ctx);
	});

	pi.on("input", (_event, ctx) => {
		void refresh(ctx);
	});

	pi.on("tool_result", (_event, ctx) => {
		void refresh(ctx);
	});

	pi.on("turn_end", (_event, ctx) => {
		void refresh(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		sessionActive = false;
		sessionEpoch++;

		if (gitRefreshInterval) clearInterval(gitRefreshInterval);
		gitRefreshInterval = undefined;
		latestCtx = undefined;
		gitChangeCount = undefined;
		cwdReadOnly = undefined;
		cwdReadOnlyCheckedPath = undefined;
		queuedRefreshCtx = undefined;
		queuedRefreshNeedsReadOnly = false;
		publishedStatuses.clear();

		ctx.ui.setStatus(LEFT_READ_ONLY_KEY, undefined);
		ctx.ui.setStatus(RIGHT_GIT_KEY, undefined);
	});

	pi.registerCommand(REFRESH_COMMAND, {
		description: "Refresh footer Git and workspace writability status",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("Footer workspace status is available only in TUI mode", "warning");
				return;
			}
			await refresh(ctx, { forceReadOnly: true });
			ctx.ui.notify("Footer workspace status refreshed", "info");
		},
	});
}
