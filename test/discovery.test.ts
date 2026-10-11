import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { discover, parseConfig } from "../src/discovery.ts";
import { temporary, repository, git, exec } from "./helpers.ts";
const signal = () => new AbortController().signal;
test("discover owner and immediate products, including ignored repos, but not grandchildren", async t => {
	const root = await repository(await temporary(t));
	await writeFile(join(root, ".gitignore"), "*\n");
	await repository(join(root, "one"));
	await repository(join(root, "two"));
	await repository(join(root, "container", "deep"));
	await mkdir(join(root, "ordinary"));
	const inventory = await discover(exec, root, undefined, signal());
	assert.deepEqual(inventory.repositories.map(repo => repo.label), ["workspace", "one", "two"]);
	assert.deepEqual(inventory.issues, []);
});
test("default scope from inside a product does not include its siblings", async t => {
	const root = await repository(await temporary(t));
	const product = await repository(join(root, "one")); await repository(join(root, "two"));
	await mkdir(join(product, "src"));
	const inventory = await discover(exec, join(product, "src"), undefined, signal());
	assert.equal(inventory.root, product);
	assert.deepEqual(inventory.repositories.map(repo => repo.path), [product]);
	const explicit = await discover(exec, product, root, signal());
	assert.equal(explicit.repositories.length, 3);
});
test("non-Git directory can contain product repositories", async t => {
	const root = await temporary(t); await repository(join(root, "one"));
	const inventory = await discover(exec, root, undefined, signal());
	assert.equal(inventory.repositories.length, 1);
});
test("includes allow deeper repos and aliases; exclusions and deduplication use canonical paths", async t => {
	const root = await repository(await temporary(t));
	const one = await repository(join(root, "one"));
	await repository(join(root, "container", "deep"));
	await symlink(one, join(root, "alias"), "dir");
	await mkdir(join(root, ".pi"));
	await writeFile(join(root, ".pi", "workspace.json"), JSON.stringify({ include: ["alias", "container/deep", "ordinary"], exclude: ["one"] }));
	await mkdir(join(root, "ordinary"));
	const inventory = await discover(exec, root, undefined, signal());
	assert.deepEqual(inventory.repositories.map(repo => repo.label), ["workspace", "container/deep"]);
	assert.match(inventory.issues[0], /not a worktree root/);
});
test("automatic discovery does not follow child symlinks", async t => {
	const root = await temporary(t); const external = await repository(await temporary(t));
	await symlink(external, join(root, "alias"), "dir");
	assert.equal((await discover(exec, root, undefined, signal())).repositories.length, 0);
});
test("Git files identify linked worktrees; common Git directory does not deduplicate them", async t => {
	const root = await temporary(t); const first = await repository(join(root, "one"));
	await git(first, "worktree", "add", "-qb", "other", join(root, "two"));
	const inventory = await discover(exec, root, undefined, signal());
	assert.deepEqual(inventory.repositories.map(repo => repo.label), ["one", "two"]);
});
for (const value of ['[]', '{"depth":4}', '{"include":"one"}', '{"exclude":[null]}', '{"include":[""]}']) {
	test(`invalid configuration: ${value}`, () => assert.throws(() => parseConfig(value)));
}
test("bad configuration is not silently replaced by defaults", async t => {
	const root = await repository(await temporary(t)); await mkdir(join(root, ".pi"));
	await writeFile(join(root, ".pi", "workspace.json"), "not json");
	await assert.rejects(discover(exec, root, undefined, signal()), /workspace.json/);
});
