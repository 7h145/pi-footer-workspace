import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { probe } from "../src/probe.ts";
import { temporary } from "./helpers.ts";
test("real writable directory is left without a probe file", async t => {
	const root = await temporary(t); assert.deepEqual(await probe(root), { readOnly: false });
	assert.deepEqual(await readdir(root), []);
});
for (const code of ["EEXIST", "EACCES", "EROFS", "ENOENT", "ENOSPC"]) {
	test(`failed create never unlinks someone else's path: ${code}`, async () => {
		let deleted = false;
		const result = await probe(".", { open: async () => { throw Object.assign(new Error(), { code }); }, unlink: async () => { deleted = true; } });
		assert.equal(deleted, false);
		assert.equal(result.readOnly, ["EACCES", "EROFS"].includes(code) ? true : undefined);
	});
}
test("close failure still attempts unlink and reports cleanup failure", async () => {
	let deleted = false;
	const result = await probe(".", { open: async () => ({ close: async () => { throw new Error(); } }), unlink: async () => { deleted = true; } });
	assert.equal(deleted, true); assert.equal(result.readOnly, false); assert.match(result.error!, /probe/);
});
test("unlink failure is reported", async () => {
	const result = await probe(".", { open: async () => ({ close: async () => {} }), unlink: async () => { throw new Error(); } });
	assert.match(result.error!, /probe/);
});
