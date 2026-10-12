import { discover, type Inventory, type Repository } from "./discovery.ts";
import { readStatus, withAbort, type Exec, type GitStatus } from "./git.ts";
import { probe, type Writability } from "./probe.ts";

export interface RepositoryState extends Repository { status?: GitStatus; error?: string; }
export interface Snapshot {
	root: string;
	cwd: string;
	repositories: RepositoryState[];
	issues: string[];
	writability: Writability;
	updatedAt: number;
}
export interface Dependencies {
	exec: Exec;
	discover: typeof discover;
	readStatus: typeof readStatus;
	probe: typeof probe;
}
export const dependencies = (exec: Exec): Dependencies => ({ exec, discover, readStatus, probe });
interface Options { discover?: boolean; probe?: boolean; }
interface Waiter { resolve(snapshot: Snapshot): void; reject(error: unknown): void; }

/** One instance owns one session: work, queued requests, and cached plain data. */
export class WorkspaceSession {
	readonly controller = new AbortController();
	snapshot?: Snapshot;
	private inventory?: Inventory;
	private discoveryFailure?: string;
	private pending: Options = {};
	private waiters: Waiter[] = [];
	private running = false;

	readonly cwd: string;
	readonly explicitRoot: string | undefined;
	private readonly deps: Dependencies;
	private readonly changed: (snapshot: Snapshot) => void;
	constructor(cwd: string, explicitRoot: string | undefined, deps: Dependencies, changed: (snapshot: Snapshot) => void) {
		this.cwd = cwd; this.explicitRoot = explicitRoot; this.deps = deps; this.changed = changed;
	}

	get busy() { return this.running; }
	get closed() { return this.controller.signal.aborted; }
	stop() {
		this.controller.abort();
		for (const waiter of this.waiters.splice(0)) waiter.reject(this.controller.signal.reason);
	}

	request(options: Options = {}): Promise<Snapshot> {
		if (this.closed) return Promise.reject(this.controller.signal.reason);
		this.pending.discover ||= options.discover === true;
		this.pending.probe ||= options.probe === true;
		const task = new Promise<Snapshot>((resolve, reject) => this.waiters.push({ resolve, reject }));
		if (!this.running) void this.drain();
		return task;
	}

	private async drain() {
		this.running = true;
		try {
			while (!this.closed && this.waiters.length) {
				const waiters = this.waiters.splice(0);
				const options = this.pending;
				this.pending = {};
				try {
					const snapshot = await withAbort(this.scan(options), this.controller.signal);
					this.controller.signal.throwIfAborted();
					this.snapshot = snapshot;
					this.changed(snapshot);
					for (const waiter of waiters) waiter.resolve(snapshot);
				} catch (error) {
					for (const waiter of waiters) waiter.reject(error);
				}
			}
		} finally { this.running = false; }
	}

	private async scan(options: Options): Promise<Snapshot> {
		const signal = this.controller.signal;
		// Writability is independent of discovery, and cleanup precedes Git scans.
		const writability = !this.snapshot || options.probe ? await this.deps.probe(this.cwd) : this.snapshot.writability;
		signal.throwIfAborted();
		let inventory = this.inventory;
		if (!inventory || options.discover) {
			try {
				inventory = await this.deps.discover(this.deps.exec, this.cwd, this.explicitRoot, signal);
				signal.throwIfAborted();
				this.inventory = inventory;
				this.discoveryFailure = undefined;
			} catch (error) {
				signal.throwIfAborted();
				this.discoveryFailure = error instanceof Error && error.message.startsWith("Cannot read .pi/git-monitor.json")
					? error.message : "Cannot discover workspace repositories";
				return { root: inventory?.root ?? this.explicitRoot ?? this.cwd, cwd: this.cwd,
					repositories: (inventory?.repositories ?? []).map(repo => ({ ...repo, error: "Workspace discovery failed" })),
					issues: [this.discoveryFailure],
					writability, updatedAt: Date.now() };
			}
		}
		const repositories: RepositoryState[] = new Array(inventory.repositories.length);
		let next = 0;
		const worker = async () => {
			while (next < inventory.repositories.length) {
				signal.throwIfAborted();
				const index = next++;
				const repo = inventory.repositories[index];
				const state = await this.deps.readStatus(this.deps.exec, repo.path, signal);
				signal.throwIfAborted();
				repositories[index] = { ...repo, ...state };
			}
		};
		await Promise.all([worker(), worker()]);
		signal.throwIfAborted();
		return { root: inventory.root, cwd: this.cwd, repositories,
			issues: [...inventory.issues, ...(this.discoveryFailure ? [this.discoveryFailure] : [])],
			writability, updatedAt: Date.now() };
	}
}
