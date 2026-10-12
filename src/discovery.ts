import { promises as fs } from "node:fs";
import * as path from "node:path";
import { runGit, type Exec } from "./git.ts";

export interface Repository { path: string; label: string; }
export interface Inventory { root: string; repositories: Repository[]; issues: string[]; }
interface Config { include: string[]; exclude: string[]; }

export function parseConfig(text: string): Config {
	const value: unknown = JSON.parse(text);
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
	const data = value as Record<string, unknown>;
	if (Object.keys(data).some(key => key !== "include" && key !== "exclude")) throw new Error("Unknown setting");
	const result: Config = { include: [], exclude: [] };
	for (const key of ["include", "exclude"] as const) {
		const list = data[key] === undefined ? [] : data[key];
		if (!Array.isArray(list) || list.some(item => typeof item !== "string" || !item || item.includes("\0"))) throw new Error("Expected nonempty paths");
		result[key] = list as string[];
	}
	return result;
}

async function canonical(directory: string): Promise<string> {
	return fs.realpath(directory);
}
function topLevel(stdout: string): string { return stdout.replace(/\r?\n$/, ""); }

export async function discover(exec: Exec, cwd: string, explicitRoot: string | undefined, signal: AbortSignal): Promise<Inventory> {
	signal.throwIfAborted();
	const anchor = await canonical(path.resolve(cwd, explicitRoot ?? "."));
	signal.throwIfAborted();
	const containing = await runGit(exec, anchor, ["rev-parse", "--show-toplevel"], signal);
	const owner = containing.ok ? await canonical(topLevel(containing.stdout)) : undefined;
	const root = explicitRoot === undefined ? owner ?? anchor : anchor;
	let config: Config = { include: [], exclude: [] };
	try { config = parseConfig(await fs.readFile(path.join(root, ".pi", "git-monitor.json"), "utf8")); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Cannot read .pi/git-monitor.json: use include/exclude arrays of paths");
	}
	signal.throwIfAborted();
	const inventory: Inventory = { root, repositories: [], issues: [] };
	const excluded = new Set<string>();
	for (const item of config.exclude) {
		const target = path.resolve(root, item);
		excluded.add(await canonical(target).catch(() => target));
	}
	const candidates: { directory: string; required: boolean; owner?: boolean }[] = [];
	if (owner) candidates.push({ directory: owner, required: true, owner: true });
	else if (!containing.ok && !containing.notRepository) inventory.issues.push(containing.error);
	try {
		const children = await fs.readdir(root, { withFileTypes: true });
		for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
			signal.throwIfAborted();
			if (!child.isDirectory() || child.name === ".git") continue;
			const directory = path.join(root, child.name);
			try {
				await fs.lstat(path.join(directory, ".git"));
				candidates.push({ directory, required: false });
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") inventory.issues.push(`Cannot inspect ${directory}`);
			}
		}
	} catch (error) {
		signal.throwIfAborted();
		inventory.issues.push("Cannot enumerate workspace directories");
	}
	for (const item of config.include) candidates.push({ directory: path.resolve(root, item), required: true });
	const seen = new Set<string>();
	for (const candidate of candidates) {
		signal.throwIfAborted();
		let directory: string;
		try { directory = await canonical(candidate.directory); }
		catch { if (candidate.required) inventory.issues.push(`Cannot access included repository: ${candidate.directory}`); continue; }
		if (excluded.has(directory) || seen.has(directory)) continue;
		seen.add(directory);
		const result = candidate.owner
			? { ok: true as const, stdout: directory }
			: await runGit(exec, directory, ["rev-parse", "--show-toplevel"], signal);
		if (!result.ok) {
			inventory.issues.push(`Cannot identify repository ${candidate.directory}: ${result.error}`);
			continue;
		}
		const actual = await canonical(topLevel(result.stdout)).catch(() => undefined);
		if (actual !== directory) {
			if (candidate.required) inventory.issues.push(`Included path is not a worktree root: ${candidate.directory}`);
			continue;
		}
		const relative = path.relative(root, directory);
		inventory.repositories.push({ path: directory,
			label: directory === root ? "workspace" : relative === "workspace" ? "./workspace" : relative });
	}
	return inventory;
}
