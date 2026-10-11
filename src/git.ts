import type { ExecOptions, ExecResult } from "@earendil-works/pi-coding-agent";

export type Exec = (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>;
export interface Change {
	path: string;
	originalPath?: string;
	index: string;
	worktree: string;
	kind: "tracked" | "untracked" | "conflict";
}
export interface GitStatus {
	branch: string;
	upstream?: string;
	ahead?: number;
	behind?: number;
	changes: Change[];
}
export type GitResult = { ok: true; stdout: string } | { ok: false; error: string; notRepository?: boolean };

export function withAbort<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise((resolve, reject) => {
		const aborted = () => reject(signal.reason);
		signal.addEventListener("abort", aborted, { once: true });
		if (signal.aborted) aborted();
		task.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
	});
}

export async function runGit(exec: Exec, directory: string, args: string[], signal: AbortSignal): Promise<GitResult> {
	signal.throwIfAborted();
	const deadline = new AbortController();
	const timeout = setTimeout(() => deadline.abort(), 2_000);
	timeout.unref();
	const combined = AbortSignal.any([signal, deadline.signal]);
	try {
		const result = await withAbort(exec("git", ["--no-optional-locks", "-C", directory, ...args],
			{ signal: combined, timeout: 2_000 }), combined);
		signal.throwIfAborted();
		if (result.killed) return { ok: false, error: "Git request interrupted or timed out" };
		if (result.code !== 0) return { ok: false, error: `Git request failed (exit ${result.code})`,
			notRepository: /not a git repository/i.test(result.stderr) };
		return { ok: true, stdout: result.stdout };
	} catch {
		signal.throwIfAborted();
		return { ok: false, error: deadline.signal.aborted ? "Git request timed out" : "Git request failed" };
	} finally {
		clearTimeout(timeout);
	}
}

export function parseStatus(output: string): GitStatus {
	if (!output.endsWith("\0")) throw new Error("Incomplete Git status");
	const records = output.split("\0");
	records.pop();
	const status: GitStatus = { branch: "", changes: [] };
	for (let i = 0; i < records.length; i++) {
		const record = records[i];
		if (record.startsWith("# branch.head ")) status.branch = record.slice(14);
		else if (record.startsWith("# branch.upstream ")) status.upstream = record.slice(18);
		else if (record.startsWith("# branch.ab ")) {
			const counts = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record);
			if (!counts) throw new Error("Invalid upstream counts");
			status.ahead = Number(counts[1]);
			status.behind = Number(counts[2]);
			if (!Number.isSafeInteger(status.ahead) || !Number.isSafeInteger(status.behind)) throw new Error("Invalid upstream counts");
		} else if (record.startsWith("# ")) continue;
		else if (record.startsWith("? ")) {
			if (record.length === 2) throw new Error("Missing path");
			status.changes.push({ path: record.slice(2), index: "?", worktree: "?", kind: "untracked" });
		} else if (record.startsWith("! ")) continue;
		else {
			const fields = record.split(" ");
			const kind = fields[0];
			const offset = kind === "1" ? 8 : kind === "2" ? 9 : kind === "u" ? 10 : 0;
			const file = fields.slice(offset).join(" ");
			if (!offset || !file || !/^[.MADRCUT]{2}$/.test(fields[1] ?? "")) throw new Error("Invalid change record");
			const change: Change = { path: file, index: fields[1][0], worktree: fields[1][1],
				kind: kind === "u" ? "conflict" : "tracked" };
			if (kind === "2") {
				change.originalPath = records[++i];
				if (!change.originalPath) throw new Error("Missing rename source");
			}
			status.changes.push(change);
		}
	}
	if (!status.branch) throw new Error("Missing branch information");
	return status;
}

export async function readStatus(exec: Exec, directory: string, signal: AbortSignal): Promise<{ status?: GitStatus; error?: string }> {
	const result = await runGit(exec, directory, ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"], signal);
	if (!result.ok) return { error: result.error };
	try { return { status: parseStatus(result.stdout) }; }
	catch { return { error: "Git returned incomplete or invalid status" }; }
}
