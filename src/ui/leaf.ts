import type { WorkspaceLeaf } from "obsidian";

/**
 * Read a workspace leaf's tab-header element. `tabHeaderEl` is a non-public
 * Obsidian field, so the unchecked cast is isolated here. Returns null when the
 * leaf has no tab header (e.g. some embedded/popout contexts).
 */
export function getTabHeaderEl(leaf: WorkspaceLeaf | null | undefined): HTMLElement | null {
	if (!leaf) return null;
	return (leaf as unknown as { tabHeaderEl?: HTMLElement }).tabHeaderEl ?? null;
}
