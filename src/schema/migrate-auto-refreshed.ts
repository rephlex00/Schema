import type { FieldSchema } from "./types";

interface LegacyAutoRefreshed {
	name?: unknown;
	kind?: unknown;
}

/**
 * Fold a legacy `autoRefreshedFields` list (`[{ name, kind }]`) into the
 * global-property registry as *universal* properties: `icon` -> Icon,
 * `color` -> Color, anything else -> Input. Per-type values already live in
 * each schema's `defaults` map and are left untouched.
 *
 * Idempotent and non-destructive: an existing global of the same name is only
 * patched to set `universal: true` (its type/options are preserved). Returns a
 * (possibly new) registry plus whether anything changed.
 */
export function foldAutoRefreshedIntoGlobals(
	globalFields: Record<string, FieldSchema>,
	legacy: unknown
): { globalFields: Record<string, FieldSchema>; changed: boolean } {
	if (!Array.isArray(legacy) || legacy.length === 0) {
		return { globalFields, changed: false };
	}
	const next = { ...globalFields };
	let changed = false;
	for (const item of legacy as LegacyAutoRefreshed[]) {
		const name = typeof item?.name === "string" ? item.name : undefined;
		if (!name) continue;
		const kind = typeof item?.kind === "string" ? item.kind : undefined;
		const type: FieldSchema["type"] =
			kind === "icon" || name === "icon"
				? "Icon"
				: kind === "color" || name === "color"
					? "Color"
					: "Input";
		const existing = next[name];
		if (existing) {
			if (existing.universal !== true) {
				next[name] = { ...existing, universal: true };
				changed = true;
			}
		} else {
			next[name] = { name, type, universal: true };
			changed = true;
		}
	}
	return { globalFields: next, changed };
}
