import type { RepositoryState, Snapshot } from "./session.ts";

/** Escape controls in repository names, Git paths and diagnostics before display. */
export function display(text: string): string {
	return text.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,
		char => char === "\n" ? "\\n" : char === "\t" ? "\\t" : char === "\r" ? "\\r"
			: `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
export function summary(snapshot: Snapshot): { text: string; color: "success" | "warning" | "error" } | undefined {
	const total = snapshot.repositories.length;
	const unknown = snapshot.repositories.filter(repo => !repo.status).length;
	const dirty = snapshot.repositories.filter(repo => repo.status?.changes.length).length;
	const conflict = snapshot.repositories.some(repo => repo.status?.changes.some(change => change.kind === "conflict"));
	if (!total) return snapshot.issues.length ? { text: "git scope ?", color: "warning" } : undefined;
	const parts = unknown || dirty ? [`git ${dirty}/${total} dirty`] : [`git ${total} clean`];
	if (unknown) parts.push(`${unknown} unknown`);
	if (snapshot.issues.length) parts.push("scope ?");
	return { text: parts.join(", "), color: conflict ? "error" : unknown || dirty || snapshot.issues.length ? "warning" : "success" };
}
export function state(repo: RepositoryState): string {
	if (!repo.status) return "unavailable";
	const changes = repo.status.changes;
	const conflicts = changes.filter(change => change.kind === "conflict").length;
	if (conflicts) return `${conflicts} conflict${conflicts === 1 ? "" : "s"}`;
	return changes.length ? `${changes.length} changed` : "clean";
}
export function upstream(repo: RepositoryState): string {
	const status = repo.status;
	if (!status) return "unknown";
	if (!status.upstream) return "—";
	if (status.ahead === undefined || status.behind === undefined) return "counts unavailable";
	if (!status.ahead && !status.behind) return "up to date";
	return [status.ahead ? `ahead ${status.ahead}` : "", status.behind ? `behind ${status.behind}` : ""].filter(Boolean).join(", ");
}
export function overview(snapshot: Snapshot): string[] {
	return [`Workspace: ${display(snapshot.root)}`,
		summary(snapshot)?.text ?? "No repositories found",
		...snapshot.repositories.map(repo => `${display(repo.label)} | ${display(repo.status?.branch ?? "unknown")} | ${state(repo)} | ${upstream(repo)}`),
		...notices(snapshot)];
}
export function notices(snapshot: Snapshot): string[] {
	return [
		...(snapshot.writability.readOnly ? [`Working directory is read-only: ${display(snapshot.cwd)}`] : []),
		...(snapshot.writability.error ? [display(snapshot.writability.error)] : []),
		...snapshot.issues.map(display),
	];
}
export function details(repo: RepositoryState): string[] {
	const status = repo.status;
	if (!status) return [display(repo.path), display(repo.error ?? "Status unavailable")];
	return [display(repo.path), `Branch: ${display(status.branch)}`,
		`Upstream: ${display(status.upstream ?? "none")} (${upstream(repo)})`,
		`Working tree: ${state(repo)}`, "",
		"Index / worktree: . unchanged, ? untracked, U conflict",
		...status.changes.map(change => `${change.index}${change.worktree} ${display(change.path)}${change.originalPath ? ` <- ${display(change.originalPath)}` : ""}`)];
}
