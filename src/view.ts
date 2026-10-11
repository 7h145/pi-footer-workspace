import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { details, display, notices, state, summary, upstream } from "./format.ts";
import type { Snapshot } from "./session.ts";

const cell = (text: string, width: number) => {
	const truncated = truncateToWidth(text, width);
	return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
};

/** A read-only, keyboard-driven snapshot; no Git actions or live session context. */
export class WorkspaceView {
	private selected = 0;
	private detail = false;
	private showingNotices = false;
	private scroll = 0;
	private pageSize = 10;
	private readonly snapshot: Snapshot;
	private readonly theme: Theme;
	private readonly height: () => number;
	private readonly renderAgain: () => void;
	private readonly done: () => void;
	constructor(snapshot: Snapshot, theme: Theme, height: () => number, renderAgain: () => void, done: () => void, initial?: number) {
		this.snapshot = snapshot; this.theme = theme; this.height = height; this.renderAgain = renderAgain; this.done = done;
		if (initial !== undefined) { this.selected = initial; this.detail = true; }
	}
	invalidate() {}
	handleInput(data: string) {
		if (matchesKey(data, Key.escape) || data === "q") {
			if (this.detail || this.showingNotices) { this.detail = this.showingNotices = false; this.scroll = 0; }
			else this.done();
		} else if (data === "n" && !this.detail) {
			this.showingNotices = !this.showingNotices; this.scroll = 0;
		} else if (matchesKey(data, Key.enter) && !this.detail && !this.showingNotices && this.snapshot.repositories.length) {
			this.detail = true; this.scroll = 0;
		} else {
			const step = matchesKey(data, Key.pageUp) ? -this.pageSize : matchesKey(data, Key.pageDown) ? this.pageSize
				: matchesKey(data, Key.up) || data === "k" ? -1 : matchesKey(data, Key.down) || data === "j" ? 1 : 0;
			if (this.detail || this.showingNotices) this.scroll = Math.max(0, this.scroll + step);
			else this.selected = Math.max(0, Math.min(this.snapshot.repositories.length - 1, this.selected + step));
		}
		this.renderAgain();
	}
	render(width: number): string[] {
		const maxHeight = Math.max(1, this.height() - 2);
		this.pageSize = Math.max(1, maxHeight - 5);
		const title = this.detail ? `Repository: ${display(this.snapshot.repositories[this.selected].label)}`
			: `Workspace: ${display(this.snapshot.root)}`;
		const lines = [this.theme.fg("accent", title)];
		if (this.detail || this.showingNotices) {
			const content = this.detail ? details(this.snapshot.repositories[this.selected])
				: [`Checked: ${new Date(this.snapshot.updatedAt).toISOString()}`,
					`Working directory: ${display(this.snapshot.cwd)}`,
					`Writability: ${this.snapshot.writability.readOnly === undefined ? "unknown" : this.snapshot.writability.readOnly ? "read-only" : "writable"}`,
					...notices(this.snapshot)];
			const body = content.flatMap(line => wrapTextWithAnsi(line, Math.max(1, width)));
			this.scroll = Math.min(this.scroll, Math.max(0, body.length - this.pageSize));
			lines.push(...body.slice(this.scroll, this.scroll + this.pageSize));
		} else {
			lines.push(summary(this.snapshot)?.text ?? "No repositories found");
			const nameWidth = Math.max(8, Math.floor(width * 0.35));
			const branchWidth = Math.max(6, Math.floor(width * 0.18));
			lines.push("  " + cell("Repository", nameWidth) + " " + cell("Branch", branchWidth) + " Working tree | Upstream");
			const start = Math.max(0, this.selected - this.pageSize + 1);
			const repos = this.snapshot.repositories.slice(start, start + this.pageSize);
			lines.push(...repos.map((repo, i) => {
				const text = (start + i === this.selected ? "> " : "  ") + cell(display(repo.label), nameWidth)
					+ " " + cell(display(repo.status?.branch ?? "?"), branchWidth) + ` ${state(repo)} | ${upstream(repo)}`;
				return start + i === this.selected ? this.theme.fg("accent", text) : text;
			}));
			// A separate scrollable page keeps diagnostics from hiding repositories.
			const notice = notices(this.snapshot)[0];
			if (notice) lines.push(this.theme.fg("warning", notice));
		}
		lines.push(this.theme.fg("dim", this.detail || this.showingNotices ? "↑/↓ PgUp/PgDn scroll • Esc back"
			: "↑/↓ select • Enter details • n notices • Esc close"));
		return lines.slice(0, maxHeight).map(line => truncateToWidth(line, Math.max(1, width)));
	}
}
