import { test } from "node:test";
import assert from "node:assert/strict";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { summary, display, details } from "../src/format.ts";
import { WorkspaceView } from "../src/view.ts";
import type { Snapshot } from "../src/session.ts";
const theme = { fg: (_color: string, text: string) => text } as Theme;
const snapshot = (): Snapshot => ({ root: "/workspace", cwd: "/workspace", repositories: [
	{ path: "/workspace", label: "workspace", status: { branch: "main", changes: [] } },
	{ path: "/workspace/产品", label: "产品", status: { branch: "main", changes: [{ path: "long name\n\u001b[31m", index: "M", worktree: ".", kind: "tracked" }] } },
], issues: [], writability: { readOnly: false }, updatedAt: 10_000 });
test("aggregate distinguishes clean, dirty, unknown and incomplete scope", () => {
	const s = snapshot();assert.equal(summary(s)?.text, "git 1/2 dirty");
	s.repositories[1] = { path: "/two", label: "two", error: "failed" };assert.equal(summary(s)?.text, "git 0/2 dirty, 1 unknown");
	s.issues.push("failed discovery");assert.match(summary(s)!.text, /scope \?/);
	s.repositories = [];s.issues = [];assert.equal(summary(s), undefined);
});
test("controls are escaped and cannot inject terminal commands", () => {
	assert.equal(display("x\n\t\u001b[31m\u009b\u202e"), "x\\n\\t\\u001b[31m\\u009b\\u202e");
	assert.ok(!details(snapshot().repositories[1]).join("\n").includes("\u001b"));
});
for (const width of [1, 12, 40, 110]) {
	test(`view respects narrow widths, Unicode and viewport height: ${width}`, () => {
		const view = new WorkspaceView(snapshot(), theme, () => 12, () => {}, () => {});
		for (const key of ["", "j", "\r", "j", "\u001b", "n"]) {
			if (key) view.handleInput(key);
			const lines = view.render(width);assert.ok(lines.length <= 10);
			assert.ok(lines.every(line => visibleWidth(line) <= width));
		}
	});
}
test("selection opens details; Escape returns to overview and then closes", () => {
	let closed = false;const view = new WorkspaceView(snapshot(), theme, () => 24, () => {}, () => { closed = true; });
	view.handleInput("j");view.handleInput("\r");assert.match(view.render(110).join("\n"), /Repository: 产品/);
	view.handleInput("\u001b");assert.match(view.render(110).join("\n"), /Workspace:/);assert.equal(closed, false);
	view.handleInput("\u001b");assert.equal(closed, true);
});
test("notices page makes all scope errors accessible with scrolling", () => {
	const s = snapshot();s.issues = Array.from({ length: 30 }, (_, i) => `issue ${i}`);
	const view = new WorkspaceView(s, theme, () => 12, () => {}, () => {});view.handleInput("n");
	for (let i = 0; i < 40; i++) view.handleInput("j");
	assert.match(view.render(110).join("\n"), /issue 29/);
});
