import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

export interface Writability { readOnly?: boolean; error?: string; }
export interface ProbeIO {
	open: (file: string, flags: string) => Promise<{ close(): Promise<void> }>;
	unlink: (file: string) => Promise<void>;
}
export async function probe(directory: string, io: ProbeIO = fs): Promise<Writability> {
	const file = join(directory, `.pi-write-probe-${randomUUID()}`);
	let handle: Awaited<ReturnType<ProbeIO["open"]>>;
	try { handle = await io.open(file, "wx"); }
	catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		return ["EACCES", "EPERM", "EROFS"].includes(code ?? "")
			? { readOnly: true } : { error: "Could not check working-directory writability" };
	}
	let cleanupFailed = false;
	try { await handle.close(); } catch { cleanupFailed = true; }
	try { await io.unlink(file); } catch { cleanupFailed = true; }
	return { readOnly: false, ...(cleanupFailed ? { error: `Could not remove writability probe: ${file}` } : {}) };
}
