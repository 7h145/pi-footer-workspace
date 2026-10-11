/** pi-footer-workspace
 *
 * Purpose: summarize the owning and product Git worktrees, with a read-only
 * /workspace overview and an optional working-directory (ro) marker.
 *
 * Strategy: discover shallowly, collect local Git status with bounded parallel
 * requests, and publish through Pi's public status API. Each session owns its
 * work and queue; no late result may update a replacement session.
 *
 * Author: thias <github.attic@typedef.net>, OpenAI Codex (5.6)
 * License: MIT
 * Version: 0.1
 * Date: 2026-07-16
 * Last verified with Pi: 1.1.0
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { dependencies, WorkspaceSession, type Dependencies } from "./src/session.ts";
import { details, overview, summary } from "./src/format.ts";
import { WorkspaceView } from "./src/view.ts";

const LEFT_KEY = "footer-compositor:left:10:workspace-read-only";
const RIGHT_KEY = "footer-compositor:right:10:workspace-git";
const POLL_MS = 15_000;
const STALE_MS = 60_000;
const DEBOUNCE_MS = 500;

export default function footerWorkspace(pi: ExtensionAPI) { setup(pi, dependencies(pi.exec.bind(pi))); }

/** Dependency injection is used only by the regression tests. */
export function setup(pi: ExtensionAPI, deps: Dependencies) {
	let session: WorkspaceSession | undefined;
	let latestCtx: ExtensionContext | undefined;
	let displayTimer: ReturnType<typeof setInterval> | undefined;
	let debounce: ReturnType<typeof setTimeout> | undefined;
	let nextPoll = 0;
	let configuredRoot: string | undefined;
	let rootResolved = false;
	const published = new Map<string, string | undefined>();
	pi.registerFlag("workspace-root", { type: "string", description: "Root for workspace repository discovery (relative to startup cwd)" });

	function setStatus(ctx: ExtensionContext, key: string, text: string | undefined) {
		if (published.has(key) && published.get(key) === text) return;
		published.set(key, text);
		ctx.ui.setStatus(key, text);
	}
	function publish(ctx: ExtensionContext) {
		if (ctx.mode !== "tui" || !session || session.closed) return;
		const snapshot = session.snapshot;
		setStatus(ctx, LEFT_KEY, snapshot?.writability.readOnly ? ctx.ui.theme.fg("warning", "(ro)") : undefined);
		const value = snapshot ? summary(snapshot) : undefined;
		const stale = snapshot && Date.now() - snapshot.updatedAt >= STALE_MS;
		setStatus(ctx, RIGHT_KEY, value ? ctx.ui.theme.fg(stale ? "warning" : value.color, value.text + (stale ? "?" : "")) : undefined);
	}
	function dispose() {
		session?.stop();
		session = undefined;
		latestCtx = undefined;
		if (displayTimer) clearInterval(displayTimer);
		if (debounce) clearTimeout(debounce);
		displayTimer = debounce = undefined;
		published.clear();
	}
	function start(ctx: ExtensionContext) {
		dispose();
		if (!rootResolved) {
			const flag = pi.getFlag("workspace-root");
			configuredRoot = typeof flag === "string" && flag ? resolve(ctx.cwd, flag) : undefined;
			rootResolved = true;
		}
		latestCtx = ctx;
		const current = new WorkspaceSession(ctx.cwd, configuredRoot, deps, () => {
			if (session === current && latestCtx) publish(latestCtx);
		});
		session = current;
		nextPoll = Date.now() + POLL_MS;
		if (ctx.mode === "tui") {
			setStatus(ctx, LEFT_KEY, undefined);
			setStatus(ctx, RIGHT_KEY, undefined);
			void current.request({ discover: true, probe: true }).catch(() => {});
			displayTimer = setInterval(() => {
				const ctx = latestCtx;
				if (!ctx || session !== current || current.closed) return;
				publish(ctx);
				if (Date.now() >= nextPoll && !current.busy && ctx.isIdle()) {
					nextPoll = Date.now() + POLL_MS;
					void current.request().catch(() => {});
				}
			}, 1_000);
			displayTimer.unref();
		}
	}
	function currentSession(ctx: ExtensionContext) {
		if (!session || session.closed || session.cwd !== ctx.cwd) start(ctx);
		latestCtx = ctx;
		return session!;
	}
	function schedule(ctx: ExtensionContext) {
		if (ctx.mode !== "tui" || !session || session.closed) return;
		const current = currentSession(ctx);
		if (debounce) clearTimeout(debounce);
		debounce = setTimeout(() => {
			debounce = undefined;
			if (session !== current || current.closed) return;
			nextPoll = Date.now() + POLL_MS;
			void current.request().catch(() => {});
		}, DEBOUNCE_MS);
		debounce.unref();
	}
	pi.on("session_start", (_event, ctx) => start(ctx));
	pi.on("tool_result", (event, ctx) => {
		if (!event.isError && ["write", "edit", "bash", "codemode"].includes(event.toolName)) schedule(ctx);
	});
	pi.on("agent_settled", (_event, ctx) => schedule(ctx));
	pi.on("session_shutdown", (_event, ctx) => {
		dispose();
		if (ctx.mode === "tui") {
			ctx.ui.setStatus(LEFT_KEY, undefined);
			ctx.ui.setStatus(RIGHT_KEY, undefined);
		}
	});

	async function command(args: string, ctx: ExtensionContext, refreshOnly: boolean) {
		if (!ctx.hasUI) throw new Error("/workspace requires TUI or RPC mode; no workspace scan was started");
		const current = currentSession(ctx);
		try {
			const snapshot = await current.request({ discover: true, probe: true });
			if (session !== current || current.closed) return;
			nextPoll = Date.now() + POLL_MS;
			if (refreshOnly) { ctx.ui.notify(overview(snapshot).join("\n"), "info"); return; }
			const name = args.trim();
			const index = name ? snapshot.repositories.findIndex(repo => repo.label === name || repo.path === name) : undefined;
			if (index === -1) { ctx.ui.notify("Repository not in this workspace. Run /workspace to see repository names.", "warning"); return; }
			if (ctx.mode === "rpc") {
				ctx.ui.notify((index === undefined ? overview(snapshot) : details(snapshot.repositories[index])).join("\n"), "info");
				return;
			}
			await ctx.ui.custom<void>((tui, theme, _keys, done) =>
				new WorkspaceView(snapshot, theme, () => tui.terminal.rows, () => tui.requestRender(), () => done(), index));
		} catch {
			if (session === current && !current.closed) ctx.ui.notify("Workspace refresh failed", "error");
		}
	}
	pi.registerCommand("workspace", { description: "Refresh and inspect workspace repositories (optional repository name)",
		handler: (args, ctx) => command(args, ctx, false) });
	pi.registerCommand("footer-workspace-refresh", { description: "Refresh workspace discovery, Git status and writability",
		handler: (args, ctx) => command(args, ctx, true) });
}
