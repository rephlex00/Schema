import { stripTemplateSegments } from "../util/folder";
import type { FieldSchema, LookupSchema, TypeSchema } from "./types";

/**
 * Inheritance resolution.
 *
 * A "raw" schema is what the user configured - only the fields/lookups/defaults
 * THEY declared, not what's inherited via `extends`. A "resolved" schema has
 * been walked up the extends chain and merged with all ancestors.
 *
 * Merge semantics:
 * - `fields` and `lookups` merge by name. Child overrides parent on collision.
 * - `defaults` is shallow-merged. Child wins per key.
 * - `folder`, `filename`, `version` use child-if-set, else parent's.
 * - `tags` do NOT merge - each type owns its own tag set. (Otherwise a child
 *   would inherit `type/parent` tag and tag-classification would be ambiguous.)
 * - `name` and `extends` are always the child's (visible, not propagated).
 * - `excludeFields` is applied at the end of each type's own step: matching
 *   names are dropped from the merged `fields` AND deleted from the merged
 *   `defaults` (a defaults key with no field would still be written by
 *   buildFrontmatter's safety net). Descendants inherit the exclusion through
 *   the already-filtered parent; re-declaring the field re-includes it.
 *
 * Cycles in the extends chain are detected and short-circuit (treated as no
 * parent at the cycle point). The validator surfaces them as errors.
 */
export function resolveSchema(
	schemas: Map<string, TypeSchema>,
	name: string,
	typeKey: string = "type"
): TypeSchema | undefined {
	const merged = resolveInner(schemas, name, new Set());
	if (!merged) return undefined;
	return appendInverseLookups(schemas, merged, typeKey);
}

export function resolveAll(schemas: Map<string, TypeSchema>, typeKey: string = "type"): TypeSchema[] {
	return Array.from(schemas.keys())
		.map((n) => resolveSchema(schemas, n, typeKey))
		.filter((s): s is TypeSchema => s != null);
}

/** A type's effective fields including those inherited via `extends` (the merge
 *  only - no inverse-lookup synthesis, so it's safe to call during synthesis).
 *  Used by inverse-lookup synthesis and the validator so a reference field
 *  declared on a parent and inherited by children registers every child type as
 *  a source. */
export function resolvedFieldsOf(
	schemas: Map<string, TypeSchema>,
	name: string
): FieldSchema[] {
	const resolved = resolveInner(schemas, name, new Set());
	return resolved ? resolved.fields : [];
}

/** Names of inverse lookups synthesized for a target type, with the source
 *  types each came from and the source-property name that triggered each
 *  synthesis. Same inverse name + same field name across multiple source
 *  types collapses into one entry (those sources share a global property,
 *  so one combined lookup gets synthesized). Used by the type editor's
 *  Backlinks cards. */
export function synthesizedInverseLookups(
	schemas: Map<string, TypeSchema>,
	targetName: string
): Array<{ name: string; sourceTypes: string[]; fieldName: string }> {
	const groups = new Map<
		string,
		{ name: string; sourceTypes: string[]; fieldName: string }
	>();
	for (const source of schemas.values()) {
		if (source.name === targetName) continue;
		for (const f of resolvedFieldsOf(schemas, source.name)) {
			if (f.target !== targetName) continue;
			if (!f.inverse || f.inverse.trim().length === 0) continue;
			const key = `${f.inverse}:::${f.name}`;
			const g =
				groups.get(key) ?? { name: f.inverse, sourceTypes: [], fieldName: f.name };
			if (!g.sourceTypes.includes(source.name)) g.sourceTypes.push(source.name);
			groups.set(key, g);
		}
	}
	return Array.from(groups.values());
}

/**
 * Append synthesized inverse lookups to an already-merged schema. Manually-
 * defined lookups (in `merged.lookups`) win on name collision; we just skip
 * synthesis for those names.
 *
 * Sources are grouped by `(inverseName, fieldName)` - when multiple types use
 * the SAME global field with an inverse, one combined lookup is synthesized
 * whose query OR-s across all source types. When two DIFFERENT field names
 * happen to claim the same inverse name on the same target (a real conflict),
 * only the first group synthesizes; the validator flags the collision.
 */
function appendInverseLookups(
	schemas: Map<string, TypeSchema>,
	merged: TypeSchema,
	typeKey: string
): TypeSchema {
	const existingNames = new Set(merged.lookups.map((l) => l.name));
	type Group = { inverseName: string; field: FieldSchema; sources: TypeSchema[] };
	const groups = new Map<string, Group>();

	for (const source of schemas.values()) {
		if (source.name === merged.name) continue; // skip self
		for (const f of resolvedFieldsOf(schemas, source.name)) {
			if (f.target !== merged.name) continue;
			if (!f.inverse || f.inverse.trim().length === 0) continue;
			const key = `${f.inverse}:::${f.name}`;
			const g = groups.get(key) ?? { inverseName: f.inverse, field: f, sources: [] };
			if (!g.sources.some((s) => s.name === source.name)) g.sources.push(source);
			groups.set(key, g);
		}
	}

	const additions: LookupSchema[] = [];
	const seenInverseNames = new Set<string>();
	const overrides = merged.backlinkOverrides ?? {};
	for (const g of groups.values()) {
		if (existingNames.has(g.inverseName)) continue; // manual wins
		if (seenInverseNames.has(g.inverseName)) continue; // distinct-fieldName collision - validator flags
		seenInverseNames.add(g.inverseName);
		const renderOverride = overrides[g.inverseName]?.render;
		additions.push(
			makeInverseLookup(g.sources, g.field, g.inverseName, typeKey, renderOverride)
		);
	}

	if (additions.length === 0) return merged;
	return {
		...merged,
		lookups: [...merged.lookups, ...additions],
	};
}

/** Synthesize one LookupSchema covering matches from all source types that
 *  share a global field with the given inverse name. Folder filter is applied
 *  only when every source resolves to the same folder; otherwise the query
 *  scans the whole vault. Type filter OR-s across sources. */
function makeInverseLookup(
	sources: TypeSchema[],
	field: FieldSchema,
	inverseName: string,
	typeKey: string,
	renderOverride?: "frontmatter" | "block"
): LookupSchema {
	// Scope the query to the source folders when every source resolves to a
	// concrete (non-templated) folder: one folder → `'"A"'`, several → a Dataview
	// source union `'"A" or "B"'`. If ANY source folder is templated/empty we
	// can't scope safely, so fall back to a whole-vault scan (slow but correct).
	const stripped = sources.map((s) => stripTemplateSegments(s.folder));
	const uniqueFolders = Array.from(new Set(stripped.filter((f) => f.length > 0)));
	const allConcrete = stripped.every((f) => f.length > 0);
	const folderArg =
		allConcrete && uniqueFolders.length > 0
			? `'${uniqueFolders.map((f) => `"${f}"`).join(" or ")}'`
			: "";

	// Dataview field access - same identifier rules as JS, so we can write
	// `s.${typeKey}` directly when the key is a valid identifier; fall back to
	// bracket notation for anything else (configurable typeKey may contain dashes).
	const tk = /^[A-Za-z_][A-Za-z0-9_]*$/.test(typeKey) ? `s.${typeKey}` : `s[${JSON.stringify(typeKey)}]`;
	const typeFilter =
		sources.length === 1
			? `${tk} === ${JSON.stringify(sources[0].name)}`
			: `(${sources.map((s) => `${tk} === ${JSON.stringify(s.name)}`).join(" || ")})`;

	const fieldName = field.name;
	const predicate =
		field.type === "MultiFile" || field.type === "Multi" || field.type === "MultiMedia"
			? `s.${fieldName} && s.${fieldName}.some(p => p.path === current.file.path)`
			: `s.${fieldName} && s.${fieldName}.path === current.file.path`;

	const query = `dv.pages(${folderArg}).filter(s => ${typeFilter} && ${predicate})`;

	return {
		name: inverseName,
		query,
		render: renderOverride ?? "frontmatter",
		output: "list",
		autoUpdate: true,
	};
}

/** The extends chain from the root ancestor down to `name` (inclusive),
 *  cycle-guarded (stops if a type is revisited). */
export function buildChain(schemas: Map<string, TypeSchema>, name: string): string[] {
	const chain: string[] = [];
	const seen = new Set<string>();
	let cur: string | undefined = name;
	while (cur && !seen.has(cur)) {
		seen.add(cur);
		chain.unshift(cur);
		cur = schemas.get(cur)?.extends;
	}
	return chain;
}

/** The nearest ancestor in `chain` (scanning root→leaf, so the last match wins)
 *  that declares a field named `fieldName`, or undefined if none do. */
function nearestDefiner(
	schemas: Map<string, TypeSchema>,
	chain: string[],
	fieldName: string
): string | undefined {
	let definer: string | undefined;
	for (const tn of chain) {
		const ts = schemas.get(tn);
		if (ts?.fields.some((f) => f.name === fieldName)) definer = tn;
	}
	return definer;
}

/** Detect cycles in the extends chain. Returns the cycle path if found, else null. */
export function detectExtendsCycle(
	schemas: Map<string, TypeSchema>,
	startName: string
): string[] | null {
	const path: string[] = [];
	const seen = new Set<string>();
	let current: string | undefined = startName;
	while (current) {
		if (seen.has(current)) {
			path.push(current);
			return path;
		}
		seen.add(current);
		path.push(current);
		const schema = schemas.get(current);
		current = schema?.extends;
	}
	return null;
}

function resolveInner(
	schemas: Map<string, TypeSchema>,
	name: string,
	seen: Set<string>
): TypeSchema | undefined {
	if (seen.has(name)) return undefined; // cycle - bail
	seen.add(name);

	const own = schemas.get(name);
	if (!own) return undefined;

	if (!own.extends) {
		return applyExclusions(cloneSchema(own));
	}

	const parent = resolveInner(schemas, own.extends, seen);
	if (!parent) return applyExclusions(cloneSchema(own));

	return applyExclusions(mergeOnto(parent, own));
}

/** Drop the schema's own excluded names from its (already merged) fields and
 *  defaults. Mutates and returns the resolved copy - safe because callers only
 *  ever hand it freshly-cloned schemas. */
function applyExclusions(merged: TypeSchema): TypeSchema {
	const excluded = merged.excludeFields;
	if (!excluded || excluded.length === 0) return merged;
	const names = new Set(excluded);
	merged.fields = merged.fields.filter((f) => !names.has(f.name));
	for (const name of names) delete merged.defaults[name];
	return merged;
}

function mergeOnto(parent: TypeSchema, child: TypeSchema): TypeSchema {
	const fieldMap = new Map<string, FieldSchema>();
	for (const f of parent.fields) fieldMap.set(f.name, cloneField(f));
	for (const f of child.fields) fieldMap.set(f.name, cloneField(f));

	const lookupMap = new Map<string, LookupSchema>();
	for (const l of parent.lookups) lookupMap.set(l.name, { ...l });
	for (const l of child.lookups) lookupMap.set(l.name, { ...l });

	return {
		name: child.name,
		extends: child.extends,
		folder: child.folder ?? parent.folder,
		filename: child.filename ?? parent.filename,
		bodyTemplate: child.bodyTemplate ?? parent.bodyTemplate,
		tags: [...child.tags],
		fields: Array.from(fieldMap.values()),
		lookups: Array.from(lookupMap.values()),
		defaults: { ...parent.defaults, ...child.defaults },
		excludeFields: child.excludeFields ? [...child.excludeFields] : undefined,
		backlinkOverrides:
			parent.backlinkOverrides || child.backlinkOverrides
				? { ...parent.backlinkOverrides, ...child.backlinkOverrides }
				: undefined,
		version: child.version ?? parent.version,
	};
}

function cloneSchema(s: TypeSchema): TypeSchema {
	return {
		name: s.name,
		extends: s.extends,
		folder: s.folder,
		filename: s.filename,
		bodyTemplate: s.bodyTemplate,
		tags: [...s.tags],
		fields: s.fields.map(cloneField),
		lookups: s.lookups.map((l) => ({ ...l })),
		defaults: { ...s.defaults },
		excludeFields: s.excludeFields ? [...s.excludeFields] : undefined,
		backlinkOverrides: s.backlinkOverrides ? { ...s.backlinkOverrides } : undefined,
		version: s.version,
	};
}

/** Deep-ish clone of a FieldSchema - `options` is a top-level dict that gets
 *  mutated by some UI code paths, so spread it; deeper nesting (e.g.
 *  options.valuesList) stays shared by reference, which is acceptable
 *  because no consumer mutates those nested values in place. */
function cloneField(f: FieldSchema): FieldSchema {
	return {
		...f,
		options: f.options ? { ...f.options } : undefined,
	};
}

/**
 * Returns the names of fields the type INHERITS from ancestors (i.e. fields
 * present in the resolved schema but not in the raw one). Useful for the
 * Settings UI to show an inheritance hint.
 */
export function inheritedFieldNames(
	schemas: Map<string, TypeSchema>,
	name: string
): string[] {
	const raw = schemas.get(name);
	if (!raw) return [];
	const resolved = resolveSchema(schemas, name);
	if (!resolved) return [];
	const own = new Set(raw.fields.map((f) => f.name));
	return resolved.fields.filter((f) => !own.has(f.name)).map((f) => f.name);
}

/**
 * Returns inherited fields together with the ancestor that contributed each one.
 * For a field inherited transitively (grandparent → parent → child), the
 * sourceType is the *nearest* ancestor that defined it (parent in that
 * example), matching what mergeOnto does at resolve time.
 */
export function inheritedFieldsWithSource(
	schemas: Map<string, TypeSchema>,
	name: string
): Array<{ field: FieldSchema; sourceType: string }> {
	const raw = schemas.get(name);
	if (!raw || !raw.extends) return [];
	const resolved = resolveSchema(schemas, name);
	if (!resolved) return [];
	const ownNames = new Set(raw.fields.map((f) => f.name));

	// Walk the chain root→leaf, tracking the most recent definer of each field.
	const definer = new Map<string, string>();
	for (const typeName of buildChain(schemas, name)) {
		if (typeName === name) continue;
		const t = schemas.get(typeName);
		if (!t) continue;
		for (const f of t.fields) definer.set(f.name, typeName);
	}

	const out: Array<{ field: FieldSchema; sourceType: string }> = [];
	for (const f of resolved.fields) {
		if (ownNames.has(f.name)) continue;
		const src = definer.get(f.name);
		if (!src) continue;
		out.push({ field: f, sourceType: src });
	}
	return out;
}

export function inheritedLookupNames(
	schemas: Map<string, TypeSchema>,
	name: string
): string[] {
	const raw = schemas.get(name);
	if (!raw) return [];
	const resolved = resolveSchema(schemas, name);
	if (!resolved) return [];
	const own = new Set(raw.lookups.map((l) => l.name));
	return resolved.lookups.filter((l) => !own.has(l.name)).map((l) => l.name);
}

/**
 * Returns the names of types whose resolved schema would lose `fieldName`
 * if it were removed from `parentTypeName`'s raw fields. That's the parent
 * itself plus every descendant whose nearest definer of `fieldName` (walking
 * the extends chain root→leaf) is the parent - i.e. the descendant doesn't
 * redefine the field itself and no intermediate ancestor does either.
 *
 * Used when deleting a field from a type to figure out which notes need
 * the property scrubbed from their frontmatter.
 */
export function typesLosingFieldOnRemoval(
	schemas: Map<string, TypeSchema>,
	parentTypeName: string,
	fieldName: string
): string[] {
	const result: string[] = [];
	for (const t of schemas.values()) {
		const chain = buildChain(schemas, t.name);
		if (!chain.includes(parentTypeName)) continue;
		if (nearestDefiner(schemas, chain, fieldName) === parentTypeName) result.push(t.name);
	}
	return result;
}
