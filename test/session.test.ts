import { test } from "node:test";
import assert from "node:assert/strict";
import { WorkspaceSession, type Dependencies } from "../src/session.ts";
import type { GitStatus } from "../src/git.ts";
import { deferred, flush, clean, fakeDependencies } from "./helpers.ts";
test("manual requests wait for their forced queued pass, not just prior work", async () => {
	const deps = fakeDependencies();const first = deferred<{ status: GitStatus }>();const second = deferred<{ status: GitStatus }>();
	let scans = 0, discoveries = 0, probes = 0;
	deps.readStatus = () => ++scans === 1 ? first.promise : second.promise;
	const discover = deps.discover;deps.discover = (...args) => { discoveries++; return discover(...args); };
	deps.probe = async () => { probes++; return { readOnly: false }; };
	const session = new WorkspaceSession("/synthetic", undefined, deps, () => {});
	const startup = session.request();await flush();
	let done = false; const manual = session.request({ discover: true, probe: true }).then(() => { done = true; });
	assert.equal(done, false);first.resolve({ status: clean });await startup;await flush();
	assert.equal(done, false);assert.equal(scans, 2);
	second.resolve({ status: clean });await manual;
	assert.equal(done, true);assert.equal(discoveries, 2);assert.equal(probes, 2);session.stop();
});
test("stopped work releases active and queued waiters and cannot publish", async () => {
	const deps = fakeDependencies();const pending = deferred<{ status: GitStatus }>();deps.readStatus = () => pending.promise;
	let publications = 0;const session = new WorkspaceSession("/old", undefined, deps, () => { publications++; });
	const active = session.request();await flush();const queued = session.request({ discover: true });
	const assertion = Promise.all([assert.rejects(active, { name: "AbortError" }), assert.rejects(queued, { name: "AbortError" })]);
	session.stop();await assertion;pending.resolve({ status: clean });await flush();
	assert.equal(publications, 0);assert.equal(session.snapshot, undefined);
});
test("a new session starts independently of outstanding old work", async () => {
	const deps = fakeDependencies();const pending = deferred<{ status: GitStatus }>();
	deps.readStatus = async (_exec, cwd) => cwd === "/old" ? pending.promise : { status: clean };
	const old = new WorkspaceSession("/old", undefined, deps, () => {});
	const task = old.request();await flush();const rejected = assert.rejects(task);old.stop();
	const next = new WorkspaceSession("/new", undefined, deps, () => {});
	assert.equal((await next.request()).root, "/new");await rejected;
	pending.resolve({ status: clean });await flush();assert.equal(next.snapshot?.root, "/new");next.stop();
});
test("probe cleanup completes before Git status and cached inventory avoids rediscovery", async () => {
	const deps = fakeDependencies();const sequence: string[] = [];let discovery = 0;
	const discover = deps.discover;deps.discover = (...args) => { discovery++;return discover(...args); };
	deps.probe = async () => { sequence.push("probe");return { readOnly: false }; };
	deps.readStatus = async () => { sequence.push("git");return { status: clean }; };
	const session = new WorkspaceSession("/synthetic", undefined, deps, () => {});
	await session.request();await session.request();
	assert.deepEqual(sequence, ["probe", "git", "git"]);assert.equal(discovery, 1);session.stop();
});
test("status collection has at most two concurrent workers", async () => {
	const deps = fakeDependencies();deps.discover = async () => ({ root: "/", issues: [],
		repositories: Array.from({ length: 10 }, (_, i) => ({ path: `/${i}`, label: String(i) })) });
	let running = 0, max = 0;
	deps.readStatus = async () => { running++;max = Math.max(max, running);await flush();running--;return { status: clean }; };
	const session = new WorkspaceSession("/", undefined, deps, () => {});
	assert.equal((await session.request()).repositories.length, 10);assert.equal(max, 2);session.stop();
});
test("discovery failure makes cached repositories unknown, not freshly clean", async () => {
	const deps = fakeDependencies();const session = new WorkspaceSession("/", undefined, deps, () => {});
	await session.request();deps.discover = async () => { throw new Error("synthetic-private-error"); };
	const snapshot = await session.request({ discover: true });
	assert.equal(snapshot.repositories[0].status, undefined);
	assert.deepEqual(snapshot.issues, ["Cannot discover workspace repositories"]);session.stop();
});
test("probe may finish cleanup after stop without publishing or starting Git", async () => {
	const deps = fakeDependencies();const pending = deferred<{ readOnly: boolean }>();deps.probe = () => pending.promise;
	let scans = 0;deps.readStatus = async () => { scans++;return { status: clean }; };
	const session = new WorkspaceSession("/", undefined, deps, () => {});
	const task = session.request();await flush();const rejected = assert.rejects(task);session.stop();await rejected;
	pending.resolve({ readOnly: false });await flush();assert.equal(scans, 0);
});

test("writability remains available when configuration discovery fails", async () => {
	const deps = fakeDependencies();deps.probe = async () => ({ readOnly: true });
	deps.discover = async () => { throw new Error("Cannot read .pi/git-monitor.json: invalid"); };
	const session = new WorkspaceSession("/", undefined, deps, () => {});
	const snapshot = await session.request();assert.equal(snapshot.writability.readOnly, true);
	assert.match(snapshot.issues[0], /git-monitor.json/);session.stop();
});

test("polling cannot erase a failed configuration refresh", async () => {
	const deps = fakeDependencies();const original = deps.discover;
	const session = new WorkspaceSession("/", undefined, deps, () => {});
	await session.request();deps.discover = async () => { throw new Error("Cannot read .pi/git-monitor.json: invalid"); };
	await session.request({ discover: true });
	assert.match((await session.request()).issues[0], /git-monitor.json/);
	deps.discover = original;
	assert.deepEqual((await session.request({ discover: true })).issues, []);session.stop();
});
