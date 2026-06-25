import { fieldShapeMatches, type FieldSchema, type TypeSchema } from "./types";

export interface ConvertAllResult {
	/** Whether any change occurred. */
	changed: boolean;
	/** Schemas with matching fields rewritten as linked stubs. */
	schemas: TypeSchema[];
	/** Updated global library (existing entries preserved). */
	globalFields: Record<string, FieldSchema>;
	/** Field names whose instances had conflicting shapes. The most-common shape
	 *  won and was promoted; the listed types still hold their original local
	 *  definitions because their shape didn't match the winner. */
	conflicts: Array<{
		name: string;
		chosenShape: FieldSchema;
		mismatchedTypes: string[];
	}>;
	/** How many new globals were promoted (existing ones aren't double-counted). */
	promoted: number;
	/** How many per-type fields were normalized down to {name, type, [promptOnCreate]}. */
	linked: number;
}

/**
 * Ensure every distinct field name across all types has a corresponding entry
 * in the global library. Singletons promote too - there is no local-field
 * concept anymore; a field name without a global is a broken reference.
 *
 * Shape conflict resolution: when a name appears with two or more shapes
 * (e.g. `Input` on type A vs `Number` on type B), the shape used by the most
 * instances wins and is promoted. Ties break by encounter order. The losing
 * instances stay in the type with their original shape and are surfaced in
 * `conflicts`; the validator will flag them so the user can rename or accept.
 *
 * Idempotent: when every field already has a matching global, `changed` is
 * false and nothing is touched.
 */
export function convertAllToGlobal(
	schemas: TypeSchema[],
	existingGlobals: Record<string, FieldSchema>
): ConvertAllResult {
	const byName = new Map<
		string,
		Array<{ schema: string; index: number; field: FieldSchema }>
	>();
	for (const schema of schemas) {
		schema.fields.forEach((f, index) => {
			const list = byName.get(f.name) ?? [];
			list.push({ schema: schema.name, index, field: f });
			byName.set(f.name, list);
		});
	}

	const newGlobals: Record<string, FieldSchema> = { ...existingGlobals };
	const matchedKeys = new Set<string>();
	const conflicts: ConvertAllResult["conflicts"] = [];
	let promoted = 0;

	for (const [name, instances] of byName) {
		const existing = newGlobals[name];

		if (existing) {
			const mismatched: string[] = [];
			for (const inst of instances) {
				if (usesGlobal(inst.field, existing)) {
					matchedKeys.add(`${inst.schema}:${inst.index}`);
				} else {
					mismatched.push(inst.schema);
				}
			}
			if (mismatched.length > 0) {
				conflicts.push({ name, chosenShape: existing, mismatchedTypes: mismatched });
			}
			continue;
		}

		const shapeGroups = new Map<string, typeof instances>();
		for (const inst of instances) {
			const key = shapeKey(inst.field);
			const arr = shapeGroups.get(key) ?? [];
			arr.push(inst);
			shapeGroups.set(key, arr);
		}
		const groups = Array.from(shapeGroups.values()).sort((a, b) => b.length - a.length);
		const winnerGroup = groups[0];
		const winner = winnerGroup[0].field;

		const global: FieldSchema = { name: winner.name, type: winner.type };
		if (winner.target !== undefined) global.target = winner.target;
		if (winner.inverse !== undefined) global.inverse = winner.inverse;
		// Deep-clone so the promoted global doesn't alias the source field's nested
		// `options` (e.g. valuesList array) - they have independent lifetimes.
		if (winner.options !== undefined) global.options = structuredClone(winner.options);
		if (winner.hidden !== undefined) global.hidden = winner.hidden;
		if (winner.universal !== undefined) global.universal = winner.universal;
		newGlobals[name] = global;
		promoted++;

		for (const inst of winnerGroup) matchedKeys.add(`${inst.schema}:${inst.index}`);

		if (groups.length > 1) {
			const mismatchedTypes = groups.slice(1).flatMap((g) => g.map((i) => i.schema));
			conflicts.push({ name, chosenShape: global, mismatchedTypes });
		}
	}

	// Strip per-type fields whose shape now matches a global down to just
	// {name, type, [promptOnCreate]}. The full shape lives in globalFields;
	// hydration re-overlays type/target/inverse/options on load. This keeps
	// data.json compact and makes the per-type entry honestly express "use the
	// global of this name". Conflicting instances are left untouched.
	let normalized = 0;
	const newSchemas = schemas.map((schema) => {
		let touched = false;
		const fields = schema.fields.map((f, index) => {
			if (!matchedKeys.has(`${schema.name}:${index}`)) return f;
			const compact: FieldSchema = { name: f.name, type: f.type };
			if (f.promptOnCreate) compact.promptOnCreate = f.promptOnCreate;
			if (
				compact.type === f.type &&
				f.target === undefined &&
				f.inverse === undefined &&
				f.options === undefined
			) {
				return f; // already compact, no rewrite
			}
			touched = true;
			normalized++;
			return compact;
		});
		return touched ? { ...schema, fields } : schema;
	});

	return {
		changed: promoted > 0 || normalized > 0,
		schemas: newSchemas,
		globalFields: newGlobals,
		conflicts,
		promoted,
		linked: normalized,
	};
}

/** Whether a per-type field already "uses" an existing global (so it needs no
 *  promotion and isn't a conflict). True when its full shape matches, OR when
 *  it's a thin stub (`{name, type}` with no explicit target/inverse/options) of
 *  the same type - such a stub simply adopts the global's shape on hydrate, so
 *  it's the normal persisted form, not a conflicting local definition. */
function usesGlobal(field: FieldSchema, global: FieldSchema): boolean {
	if (fieldShapeMatches(field, global)) return true;
	return (
		field.type === global.type &&
		field.target === undefined &&
		field.inverse === undefined &&
		field.options === undefined
	);
}

function shapeKey(f: FieldSchema): string {
	return JSON.stringify({
		type: f.type,
		target: f.target ?? "",
		inverse: f.inverse ?? "",
		options: f.options ?? {},
	});
}
