import { stripTemplateSegments } from "../util/folder";
import type { FieldSchema, LookupSchema, TypeSchema } from "./types";

/**
 * Inheritance resolution.
 *
 * A "raw" schema is what the user configured — only the fields/lookups/defaults
 * THEY declared, not what's inherited via `extends`. A "resolved" schema has
 * been walked up the extends chain and merged with all ancestors.
 *
 * Merge semantics:
 * - `fields` and `lookups` merge by name. Child overrides parent on collision.
 * - `defaults` is shallow-merged. Child wins per key.
 * - `folder`, `filename`, `version` use child-if-set, else parent's.
 * - `tags` do NOT merge — each type owns its own tag set. (Otherwise a child
 *   would inherit `type/parent` tag and tag-classification would be ambiguous.)
 * - `name` and `extends` are always the child's (visible, not propagated).
 *
 * Cycles in the extends chain are detected and short-circuit (treated as no
 * parent at the cycle point). The validator surfaces them as errors.
 */
export function resolveSchema(
	schemas: Map<string, TypeSchema>,
	name: string
): TypeSchema | undefined {
	const merged = resolveInner(schemas, name, new Set());
	if (!merged) return undefined;
	return appendInverseLookups(schemas, merged);
}

export function resolveAll(schemas: Map<string, TypeSchema>): TypeSchema[] {
	return Array.from(schemas.keys())
		.map((n) => resolveSchema(schemas, n))
		.filter((s): s is TypeSchema => s != null);
}

/** Names of inverse lookups synthesized for a target type, with the source
 *  type each came from. Used by the Settings UI's inheritance hint. */
export function synthesizedInverseLookups(
	schemas: Map<string, TypeSchema>,
	targetName: string
): Array<{ name: string; sourceType: string }> {
	const out: Array<{ name: string; sourceType: string }> = [];
	for (const source of schemas.values()) {
		if (source.name === targetName) continue;
		for (const f of source.fields) {
			if (f.target === targetName && f.inverse && f.inverse.trim().length > 0) {
				out.push({ name: f.inverse, sourceType: source.name });
			}
		}
	}
	return out;
}

/**
 * Append synthesized inverse lookups to an already-merged schema. Manually-
 * defined lookups (in `merged.lookups`) win on name collision; we just skip
 * synthesis for those names.
 */
function appendInverseLookups(
	schemas: Map<string, TypeSchema>,
	merged: TypeSchema
): TypeSchema {
	const existingNames = new Set(merged.lookups.map((l) => l.name));
	const additions: LookupSchema[] = [];
	const seenInverseNames = new Set<string>();

	for (const source of schemas.values()) {
		if (source.name === merged.name) continue; // skip self
		for (const f of source.fields) {
			if (f.target !== merged.name) continue;
			if (!f.inverse || f.inverse.trim().length === 0) continue;
			const inverseName = f.inverse;
			if (existingNames.has(inverseName)) continue; // manual wins
			if (seenInverseNames.has(inverseName)) continue; // collision — skip duplicates; validator flags
			seenInverseNames.add(inverseName);
			additions.push(makeInverseLookup(source, f, inverseName));
		}
	}

	if (additions.length === 0) return merged;
	return {
		...merged,
		lookups: [...merged.lookups, ...additions],
	};
}

/** Synthesize the Dataview JS query string + LookupSchema for one inverse pair. */
function makeInverseLookup(
	source: TypeSchema,
	field: FieldSchema,
	inverseName: string
): LookupSchema {
	const folder = stripTemplateSegments(source.folder);
	const folderArg = folder.length > 0 ? `'"${folder}"'` : "";
	const typeFilter = `s.type === ${JSON.stringify(source.name)}`;
	const fieldName = field.name;

	let predicate: string;
	if (field.type === "MultiFile" || field.type === "Multi" || field.type === "MultiMedia") {
		predicate = `s.${fieldName} && s.${fieldName}.some(p => p.path === current.file.path)`;
	} else {
		// File / Media / Cycle / Select / etc — treat as single-link
		predicate = `s.${fieldName} && s.${fieldName}.path === current.file.path`;
	}

	const query = `dv.pages(${folderArg}).filter(s => ${typeFilter} && ${predicate})`;

	return {
		name: inverseName,
		query,
		render: "frontmatter",
		output: "list",
		autoUpdate: true,
	};
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
	if (seen.has(name)) return undefined; // cycle — bail
	seen.add(name);

	const own = schemas.get(name);
	if (!own) return undefined;

	if (!own.extends) {
		return cloneSchema(own);
	}

	const parent = resolveInner(schemas, own.extends, seen);
	if (!parent) return cloneSchema(own);

	return mergeOnto(parent, own);
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
		version: s.version,
	};
}

/** Deep-ish clone of a FieldSchema — `options` is a top-level dict that gets
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
