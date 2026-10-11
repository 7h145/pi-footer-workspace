import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseStatus, readStatus, runGit } from "../src/git.ts";
import { exec, temporary, repository, git, deferred } from "./helpers.ts";
const signal = () => new AbortController().signal;
const header = "# branch.oid abc\0# branch.head main\0";

test("real Git counts individual files regardless of untracked preferences", async t => {
	const root = await repository(await temporary(t));
	await git(root, "config", "status.showUntrackedFiles", "no");
	await mkdir(join(root, "new-dir"));
	await writeFile(join(root, "new-dir", "one"), "");
	await writeFile(join(root, "new-dir", "two"), "");
	await writeFile(join(root, "tracked"), "changed\n");
	const result = await readStatus(exec, root, signal());
	assert.equal(result.status?.changes.length, 3);
	assert.equal(result.status?.branch, "main");
	assert.equal(result.error, undefined);
});
test("NUL parsing preserves spaces, newlines, tabs and rename sources", async t => {
	const root = await repository(await temporary(t));
	const name = "new \n\t name";
	await git(root, "mv", "tracked", name);
	await writeFile(join(root, name), "base\nextra\n");
	const result = await readStatus(exec, root, signal());
	assert.equal(result.status?.changes.length, 1);
	assert.deepEqual(result.status?.changes[0], { path: name, originalPath: "tracked", index: "R", worktree: "M", kind: "tracked" });
});
test("unborn and detached branches are supported", async t => {
	const root = await temporary(t);
	await git(root, "init", "-q", "-b", "main");
	assert.equal((await readStatus(exec, root, signal())).status?.branch, "main");
	await repository(root);
	await git(root, "checkout", "--detach", "-q");
	assert.equal((await readStatus(exec, root, signal())).status?.branch, "(detached)");
});
test("upstream counts and conflicts parse without network access", () => {
	const result = parseStatus(header + "# branch.upstream origin/main\0# branch.ab +2 -3\0u UU N... 100644 100644 100644 100644 a b c conflict file\0");
	assert.equal(result.upstream, "origin/main");
	assert.equal(result.ahead, 2);
	assert.equal(result.behind, 3);
	assert.equal(result.changes[0].kind, "conflict");
});
for (const output of ["", header.slice(0, -1), "# branch.oid abc\0", header + "garbage\0",
	header + "2 R. N... 100644 100644 100644 a b R100 new\0", header + "# branch.ab +x -1\0"]) {
	test(`reject malformed or partial output: ${JSON.stringify(output)}`, () => assert.throws(() => parseStatus(output)));
}
test("killed exit-zero results never become clean", async () => {
	const result = await readStatus(async () => ({ code: 0, killed: true, stdout: "", stderr: "" }), ".", signal());
	assert.equal(result.status, undefined);
	assert.match(result.error!, /interrupted/);
});
test("errors do not expose raw stderr", async () => {
	const result = await readStatus(async () => ({ code: 128, killed: false, stdout: "", stderr: "synthetic-private-detail" }), ".", signal());
	assert.equal(result.error, "Git request failed (exit 128)");
});
test("session abort releases callers even if executor ignores abort", async () => {
	const controller = new AbortController();
	const pending = deferred<never>();
	const task = runGit(() => pending.promise, ".", [], controller.signal);
	controller.abort();
	await assert.rejects(task, { name: "AbortError" });
});
test("real tracking refs produce ahead/behind without a fetch", async t => {
	const root = await repository(await temporary(t));
	await git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
	await git(root, "config", "remote.origin.url", "https://example.invalid/never-contact");
	await git(root, "config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*");
	await git(root, "branch", "--set-upstream-to=origin/main", "main");
	await writeFile(join(root, "tracked"), "next\n"); await git(root, "add", ".");
	await git(root, "-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid", "commit", "-qm", "next");
	const result = await readStatus(exec, root, signal());
	assert.equal(result.status?.ahead, 1);
	assert.equal(result.status?.behind, 0);
	assert.equal(result.status?.changes.length, 0);
});
