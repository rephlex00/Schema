import { Notice } from "obsidian";
import type { App } from "obsidian";
import type SchemaPlugin from "../main";
import type { TypeSchema } from "../schema/types";

/**
 * One-way sync: schema type colors → the global graph view's color groups.
 *
 * Each type's `defaults.color` becomes a graph color group whose query selects
 * every note of that type by its `type:` frontmatter (e.g. `[type:person]`,
 * matching Obsidian's own property-search syntax). Manual color groups the user
 * added (`tag:`, `path:`, `[subtype:…]`, …) are left untouched. The sync is
 * idempotent and is triggered explicitly by the user (command / settings
 * button) - it never runs automatically, so we don't clobber `graph.json`
 * behind the user's back.
 */

/** A single Obsidian graph-view color group, as stored in `graph.json`. */
export interface GraphColorGroup {
	/** Obsidian search query selecting the nodes to color. */
	query: string;
	/** Alpha + packed 24-bit RGB integer (e.g. 0x3b82f6 → 3900150). */
	color: { a: number; rgb: number };
}

/** Partial shape of `<configDir>/graph.json`. We only own `colorGroups`; every
 *  other key is preserved verbatim on write. */
interface GraphConfig {
	colorGroups?: GraphColorGroup[];
	[key: string]: unknown;
}

/** Convert a `#RRGGBB` / `#RGB` hex string to the packed integer Obsidian
 *  stores. Returns null when the string isn't a hex color. Pure - safe in the
 *  test (node) environment. */
export function hexToRgbInt(hex: string): number | null {
	const m = hex.trim().match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
	if (!m) return null;
	let h = m[1];
	if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
	return parseInt(h, 16);
}

/** Resolve any CSS color a type might carry (`#abc`, `#aabbcc`, `red`,
 *  `rgb(...)`) to a packed RGB integer. Hex is handled inline; everything else
 *  falls back to the DOM, which is only available at runtime - in tests
 *  (no `document`) non-hex colors resolve to null and are skipped. */
export function colorToRgbInt(color: string): number | null {
	const trimmed = color.trim();
	if (trimmed === "") return null;
	const hex = hexToRgbInt(trimmed);
	if (hex != null) return hex;
	if (typeof activeDocument === "undefined") return null;
	// Reject anything the engine doesn't recognize as a color before rendering it
	// (replaces the old empty-string style-probe trick).
	if (typeof CSS !== "undefined" && typeof CSS.supports === "function" && !CSS.supports("color", trimmed)) {
		return null;
	}
	const probe = activeDocument.createElement("div");
	probe.setCssStyles({ color: trimmed });
	activeDocument.body.appendChild(probe);
	try {
		const computed = activeWindow.getComputedStyle(probe).color; // "rgb(r, g, b)" / "rgba(…)"
		const rgb = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
		if (!rgb) return null;
		return (Number(rgb[1]) << 16) | (Number(rgb[2]) << 8) | Number(rgb[3]);
	} finally {
		probe.remove();
	}
}

/** The graph search query selecting every note of a type, keyed on the `type:`
 *  frontmatter the plugin writes. Plain names use the bare `[type:name]` form
 *  (matching the user's existing convention); names with spaces or other
 *  non-word characters are quoted so they still parse. */
export function typeColorQuery(typeName: string): string {
	return /^[A-Za-z0-9_-]+$/.test(typeName)
		? `[type:${typeName}]`
		: `["type":"${typeName}"]`;
}

/**
 * Merge schema type colors into an existing color-group list.
 *
 * A group is "schema-managed" when its query equals `typeColorQuery(name)` for
 * a type the schema currently knows about. Managed groups are rebuilt from
 * scratch each call - dropped, then re-added for every type with a resolvable
 * color - so clearing a type's color removes its group on the next sync. Every
 * other group is preserved in place. Idempotent.
 */
export function buildColorGroups(
	schemas: TypeSchema[],
	existing: GraphColorGroup[]
): GraphColorGroup[] {
	const managed = new Set(schemas.map((s) => typeColorQuery(s.name)));
	const preserved = existing.filter((g) => !managed.has(g.query));
	const added: GraphColorGroup[] = [];
	for (const s of schemas) {
		const raw = typeof s.defaults?.color === "string" ? s.defaults.color : "";
		const rgb = colorToRgbInt(raw);
		if (rgb == null) continue;
		// Graph groups are always fully opaque: type colors are solid (hex/named),
		// and colorToRgbInt only resolves an RGB triplet, so there's no alpha to
		// carry through.
		added.push({ query: typeColorQuery(s.name), color: { a: 1, rgb } });
	}
	return [...preserved, ...added];
}

/**
 * Read `graph.json`, merge in the schema type colors, write it back, and
 * live-update any open graph view. Reports the result via a Notice.
 */
export async function syncGraphColors(plugin: SchemaPlugin): Promise<void> {
	const { app } = plugin;
	const path = `${app.vault.configDir}/graph.json`;
	const adapter = app.vault.adapter;

	let config: GraphConfig = {};
	try {
		if (await adapter.exists(path)) {
			config = JSON.parse(await adapter.read(path)) as GraphConfig;
		}
	} catch (e) {
		console.error("[schema] failed to read graph.json", e);
		new Notice("Schema: couldn't read graph.json. See console.");
		return;
	}

	// Resolved (not raw) so inherited colors count - a child type with no color
	// of its own shows its ancestor's color in the banner/chip, and the graph
	// must match what the user sees on the note.
	const schemas = plugin.loader.getAllResolved();
	const existing = Array.isArray(config.colorGroups) ? config.colorGroups : [];
	const next = buildColorGroups(schemas, existing);
	config.colorGroups = next;

	try {
		await adapter.write(path, JSON.stringify(config, null, 2));
	} catch (e) {
		console.error("[schema] failed to write graph.json", e);
		new Notice("Schema: couldn't write graph.json. See console.");
		return;
	}

	applyToOpenGraphs(app, next);

	const withColor = schemas.filter((s) => {
		const c = typeof s.defaults?.color === "string" ? s.defaults.color : "";
		return c.trim() !== "";
	});
	const resolvedQueries = new Set(next.map((g) => g.query));
	const skippedNames = withColor
		.filter((s) => !resolvedQueries.has(typeColorQuery(s.name)))
		.map((s) => s.name);
	const applied = withColor.length - skippedNames.length;

	let tail = "";
	if (skippedNames.length > 0) {
		const shown = skippedNames.slice(0, 5).join(", ");
		const more = skippedNames.length > 5 ? `, +${skippedNames.length - 5} more` : "";
		tail = `. Skipped unresolvable color on: ${shown}${more}`;
		console.warn(
			"[schema] graph color sync skipped object types with unresolvable colors:",
			skippedNames
		);
	}
	new Notice(
		`Schema: synced ${applied} object-type color${applied === 1 ? "" : "s"} to the graph${tail}.`
	);
}

/** Best-effort: push the new color groups into any open graph view so it
 *  repaints without a reopen. Uses private view internals, so every access is
 *  guarded - failure just means the change shows the next time the graph opens
 *  (the file write already persisted it). */
function applyToOpenGraphs(app: App, colorGroups: GraphColorGroup[]): void {
	const leaves = [
		...app.workspace.getLeavesOfType("graph"),
		...app.workspace.getLeavesOfType("localgraph"),
	];
	for (const leaf of leaves) {
		try {
			const view = leaf.view as unknown as {
				dataEngine?: GraphEngine;
				engine?: GraphEngine;
			};
			const engine = view.dataEngine ?? view.engine;
			if (!engine) continue;
			// Each engine owns its own array - clone so they don't alias.
			const groups = colorGroups.map((g) => ({ query: g.query, color: { ...g.color } }));
			if (typeof engine.setOptions === "function") engine.setOptions({ colorGroups: groups });
			else if (engine.options) engine.options.colorGroups = groups;
			engine.render?.();
		} catch (e) {
			console.warn("[schema] couldn't live-update a graph view", e);
		}
	}
}

/** Minimal structural type for the (private) graph view engine. */
interface GraphEngine {
	options?: { colorGroups?: GraphColorGroup[] };
	setOptions?: (options: { colorGroups: GraphColorGroup[] }) => void;
	render?: () => void;
}
