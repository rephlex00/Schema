import type { App } from "obsidian";

/**
 * Return `basePath` if nothing lives there, otherwise the first ` N`-suffixed
 * variant that is free (e.g. `Note.md` → `Note 2.md` → `Note 3.md`). Used to
 * avoid overwriting an existing note when creating or moving files. Throws after
 * 1000 attempts.
 */
export async function ensureUniquePath(app: App, basePath: string): Promise<string> {
	if (!app.vault.getAbstractFileByPath(basePath)) return basePath;
	const dot = basePath.lastIndexOf(".");
	const base = dot >= 0 ? basePath.slice(0, dot) : basePath;
	const ext = dot >= 0 ? basePath.slice(dot) : "";
	for (let i = 2; i < 1000; i++) {
		const candidate = `${base} ${i}${ext}`;
		if (!app.vault.getAbstractFileByPath(candidate)) return candidate;
	}
	throw new Error(`could not find unique path for ${basePath}`);
}
