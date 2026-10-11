import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { setup } from "../pi-footer-workspace.ts";
import { fakeDependencies, clean, deferred, flush } from "./helpers.ts";
function fixture(t: TestContext, mode = "tui", root?: string) {
	const deps = fakeDependencies();
	const handlers = new Map<string, (event: any, ctx: ExtensionContext) => void>();
	const commands = new Map<string, { handler(args: string, ctx: ExtensionCommandContext): Promise<void> }>();
	const statuses = new Map<string, string | undefined>();const notifications: string[] = [];
	let discoveries = 0, scans = 0, probes = 0, idle = true, custom = 0, currentTheme = "initial";
	const discover = deps.discover;deps.discover = (...args) => { discoveries++;return discover(...args); };
	const readStatus = deps.readStatus;deps.readStatus = (...args) => { scans++;return readStatus(...args); };
	const probe = deps.probe;deps.probe = (...args) => { probes++;return probe(...args); };
	const ctx = { mode, hasUI: mode === "tui" || mode === "rpc", cwd: "/synthetic", isIdle: () => idle,
		ui: { theme: { fg: (color: string, text: string) => `${currentTheme}:${color}:${text}` },
			setStatus: (key: string, text: string | undefined) => statuses.set(key, text),
			notify: (message: string) => notifications.push(message),
			custom: async () => { custom++; } } } as unknown as ExtensionCommandContext;
	const api = { on: (event: string, handler: any) => handlers.set(event, handler),
		registerCommand: (name: string, command: any) => commands.set(name, command),
		registerFlag: () => {}, getFlag: () => root } as unknown as ExtensionAPI;
	setup(api, deps);
	t.after(() => handlers.get("session_shutdown")!({}, ctx));
	return { ctx, deps, statuses, notifications, handlers, start: () => handlers.get("session_start")!({}, ctx),
		command: (name = "workspace", args = "") => commands.get(name)!.handler(args, ctx),
		counts: () => ({ discoveries, scans, probes, custom }),
		idle: (value: boolean) => { idle = value; }, theme: (value: string) => { currentTheme = value; },
		status: () => statuses.get("footer-compositor:right:10:workspace-git") };
}
test("startup displays aggregate; idle polling uses cached membership", async t => {
	t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: 10_000 });
	const f = fixture(t);f.start();await flush();assert.equal(f.status(), "initial:success:git 1 clean");
	t.mock.timers.tick(15_000);await flush();assert.deepEqual(f.counts(), { discoveries: 1, scans: 2, probes: 1, custom: 0 });
});
test("read results do not scan; mutation bursts are debounced", async t => {
	t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: 10_000 });
	const f = fixture(t);f.start();await flush();
	f.handlers.get("tool_result")!({ toolName: "read", isError: false }, f.ctx);
	t.mock.timers.tick(500);await flush();assert.equal(f.counts().scans, 1);
	for (let i = 0; i < 10; i++) f.handlers.get("tool_result")!({ toolName: "write", isError: false }, f.ctx);
	t.mock.timers.tick(499);await flush();assert.equal(f.counts().scans, 1);
	t.mock.timers.tick(1);await flush();assert.equal(f.counts().scans, 2);
});
test("busy-state cache becomes stale and theme updates without Git requests", async t => {
	t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: 10_000 });
	const f = fixture(t);f.start();await flush();f.idle(false);f.theme("changed");
	t.mock.timers.tick(60_000);await flush();assert.equal(f.status(), "changed:warning:git 1 clean?");
	assert.equal(f.counts().scans, 1);
});
test("commands refresh membership and probe; workspace opens read-only view", async t => {
	const f = fixture(t);f.start();await flush();await f.command();
	assert.deepEqual(f.counts(), { discoveries: 2, scans: 2, probes: 2, custom: 1 });
	await f.command("footer-workspace-refresh");assert.match(f.notifications[0], /git 1 clean/);
});
test("pending manual command cannot notify or open a view after shutdown", async t => {
	const f = fixture(t);f.start();await flush();const pending = deferred<{ status: typeof clean }>();f.deps.readStatus = () => pending.promise;
	const command = f.command();await flush();f.handlers.get("session_shutdown")!({}, f.ctx);await command;
	assert.equal(f.notifications.length, 0);assert.equal(f.counts().custom, 0);
	pending.resolve({ status: clean });await flush();assert.equal(f.status(), undefined);
});
test("repeated startup owns one timer and independent session work", async t => {
	t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: 10_000 });
	const f = fixture(t);f.start();await flush();f.start();await flush();
	t.mock.timers.tick(15_000);await flush();assert.equal(f.counts().scans, 3);
});
for (const mode of ["rpc", "json", "print"]) {
	test(`no automatic work or status in ${mode}`, async t => {
		const f = fixture(t, mode);f.start();await flush();
		assert.deepEqual(f.counts(), { discoveries: 0, scans: 0, probes: 0, custom: 0 });
		assert.equal(f.statuses.size, 0);
		if (mode === "rpc") { await f.command();assert.match(f.notifications[0], /Workspace/);assert.equal(f.statuses.size, 0); }
		else { await assert.rejects(f.command(), /requires TUI or RPC/);assert.equal(f.counts().scans, 0); }
	});
}
test("explicit root is resolved once relative to startup cwd", async t => {
	const f = fixture(t, "rpc", "..");let root: string | undefined;
	const discover = f.deps.discover;f.deps.discover = (...args) => { root = args[2];return discover(...args); };
	f.start();await f.command();assert.equal(root, "/");
});
test("unknown repository arguments do not scan arbitrary paths or open a view", async t => {
	const f = fixture(t, "rpc");f.start();await f.command("workspace", "/not-in-inventory");
	assert.match(f.notifications[0], /not in this workspace/);assert.equal(f.counts().custom, 0);
});
