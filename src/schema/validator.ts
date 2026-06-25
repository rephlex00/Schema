import { buildChain, detectExtendsCycle, resolvedFieldsOf } from "./resolve";
import type { FieldSchema, TypeSchema, ValidationError, ValidationResult } from "./types";

/**
 * Per-type validation in isolation (no cross-type checks).
 *
 * Checks:
 * - Field names are unique within the type
 * - Lookup names are unique within the type
 * - Lookup names don't collide with field names
 */
export function validateOne(schema: TypeSchema): ValidationError[] {
	const errors: ValidationError[] = [];
	const seenNames = new Set<string>();

	for (const f of schema.fields) {
		if (!f.name || f.name.trim().length === 0) {
			errors.push({ type: schema.name, level: "error", message: "field has empty name" });
			continue;
		}
		if (seenNames.has(f.name)) {
			errors.push({
				type: schema.name,
				level: "error",
				message: `duplicate property name "${f.name}"`,
			});
		} else {
			seenNames.add(f.name);
		}
	}

	for (const l of schema.lookups) {
		if (!l.name || l.name.trim().length === 0) {
			errors.push({ type: schema.name, level: "error", message: "lookup has empty name" });
			continue;
		}
		if (seenNames.has(l.name)) {
			errors.push({
				type: schema.name,
				level: "error",
				message: `lookup "${l.name}" collides with a property name`,
			});
		} else {
			seenNames.add(l.name);
		}
	}

	return errors;
}

/**
 * Cross-type validation:
 * - `extends` references a known type
 * - field `target` references a known type
 * - tags are unique across types
 * - type names are unique
 * - every field's name has a corresponding entry in `globalFields` (the
 *   refactor that retired the per-type "local field" concept made this the
 *   universal invariant - a field without a global is a broken reference)
 */
export function validateAll(
	schemas: Map<string, TypeSchema>,
	globalFields: Record<string, FieldSchema> = {}
): ValidationResult {
	const errors: ValidationError[] = [];
	// A cycle is detected once per participating node (each member's chain loops
	// back). Canonicalize so we report each distinct cycle a single time instead
	// of N near-identical errors that bury the rest of the validation output.
	const reportedCycles = new Set<string>();

	for (const schema of schemas.values()) {
		errors.push(...validateOne(schema));

		for (const f of schema.fields) {
			// validateOne already reports empty names; skip to avoid a confusing
			// second "property "" has no entry in globalFields" error.
			if (!f.name || f.name.trim().length === 0) continue;
			if (!(f.name in globalFields)) {
				errors.push({
					type: schema.name,
					level: "error",
					message: `property "${f.name}" has no entry in globalFields. Fix via Settings → Schema → Global properties.`,
				});
			}
		}

		if (schema.extends && !schemas.has(schema.extends)) {
			errors.push({
				type: schema.name,
				level: "error",
				message: `extends "${schema.extends}" but no such object type is defined`,
			});
		}

		const cycle = detectExtendsCycle(schemas, schema.name);
		if (cycle) {
			const members = cycleMembers(cycle);
			const key = members.join(">");
			if (!reportedCycles.has(key)) {
				reportedCycles.add(key);
				errors.push({
					type: members[0],
					level: "error",
					message: `extends chain cycles: ${[...members, members[0]].join(" → ")}`,
				});
			}
		}

		// excludeFields sanity: excluding a name you also declare is contradictory
		// (the declaration wins at resolve time); excluding a name no ancestor
		// declares is a probable typo.
		if (schema.excludeFields && schema.excludeFields.length > 0) {
			const ownNames = new Set(schema.fields.map((f) => f.name));
			const ancestorNames = new Set<string>();
			for (const tn of buildChain(schemas, schema.name)) {
				if (tn === schema.name) continue;
				for (const f of schemas.get(tn)?.fields ?? []) ancestorNames.add(f.name);
			}
			for (const name of schema.excludeFields) {
				if (ownNames.has(name)) {
					errors.push({
						type: schema.name,
						level: "warning",
						message: `excludeFields lists "${name}" but the type also declares it; the declaration wins`,
					});
				} else if (!ancestorNames.has(name)) {
					errors.push({
						type: schema.name,
						level: "warning",
						message: `excludeFields lists "${name}" but no ancestor declares such a property`,
					});
				}
			}
		}

		for (const f of schema.fields) {
			if (f.target && !schemas.has(f.target)) {
				errors.push({
					type: schema.name,
					level: "warning",
					message: `property "${f.name}" targets "${f.target}" which is not a defined object type`,
				});
			}
			if (f.inverse && (!f.target || !schemas.has(f.target))) {
				errors.push({
					type: schema.name,
					level: "warning",
					message: `property "${f.name}" has inverse "${f.inverse}" but target "${f.target ?? "(unset)"}" is not a defined object type. Synthesis will be skipped.`,
				});
			}
		}
	}

	// Group inverse claims by (target, inverseName, fieldName). Two source types
	// both claiming an inverse on the same target is the common case after the
	// global-fields refactor - they share the same global field, so they share
	// the same field name, and the synthesis aggregates them into one lookup.
	// A real conflict is when DISTINCT field names claim the same target +
	// inverse name (e.g. type A defines `jam: { target: org, inverse: x }` and
	// type B defines `peanut_butter: { target: org, inverse: x }` - only one
	// can win).
	type InverseClaim = { fieldName: string; sourceType: string };
	const inverseClaims = new Map<string, InverseClaim[]>(); // key: `${target}::${inverseName}`
	for (const schema of schemas.values()) {
		// Resolved fields so an inherited reference field registers each descendant
		// as a claimer - matching what inverse-lookup synthesis now does.
		for (const f of resolvedFieldsOf(schemas, schema.name)) {
			if (!f.inverse || !f.target || !schemas.has(f.target)) continue;
			const key = `${f.target}::${f.inverse}`;
			const claimers = inverseClaims.get(key) ?? [];
			claimers.push({ fieldName: f.name, sourceType: schema.name });
			inverseClaims.set(key, claimers);
		}
	}
	for (const [key, claimers] of inverseClaims) {
		const uniqueFieldNames = new Set(claimers.map((c) => c.fieldName));
		if (uniqueFieldNames.size > 1) {
			const [target, inverseName] = key.split("::");
			const descs = claimers.map((c) => `${c.sourceType}.${c.fieldName}`);
			errors.push({
				type: target,
				level: "error",
				message: `distinct properties claim inverse "${inverseName}" on "${target}": ${descs.join(", ")}. Only one will be synthesized.`,
			});
		}
	}

	// Warn when synthesized inverse name collides with a manual lookup on the target.
	for (const [key, claimers] of inverseClaims) {
		const [target, inverseName] = key.split("::");
		const targetSchema = schemas.get(target);
		if (!targetSchema) continue;
		if (targetSchema.lookups.some((l) => l.name === inverseName)) {
			const sources = Array.from(new Set(claimers.map((c) => c.sourceType)));
			errors.push({
				type: target,
				level: "warning",
				message: `manual lookup "${inverseName}" takes precedence over the inverse that ${sources.join(", ")} would otherwise synthesize`,
			});
		}
	}

	const tagOwner = new Map<string, string>();
	for (const schema of schemas.values()) {
		for (const tag of schema.tags) {
			const existing = tagOwner.get(tag);
			if (existing && existing !== schema.name) {
				errors.push({
					type: schema.name,
					level: "error",
					message: `tag "${tag}" is also declared by object type "${existing}"`,
				});
			} else {
				tagOwner.set(tag, schema.name);
			}
		}
	}

	const hasError = errors.some((e) => e.level === "error");
	return { ok: !hasError, errors };
}

/**
 * Reduce a raw cycle path from `detectExtendsCycle` (which may include a tail
 * leading into the loop, e.g. `["c","a","b","a"]`) to just the loop members in
 * a canonical rotation (smallest name first, so the same cycle reached from any
 * starting node produces the same key). Returns e.g. `["a","b"]`.
 */
function cycleMembers(path: string[]): string[] {
	const last = path[path.length - 1];
	const start = path.indexOf(last);
	const loop = path.slice(start, path.length - 1); // drop the repeated closer
	let minIdx = 0;
	for (let i = 1; i < loop.length; i++) {
		if (loop[i] < loop[minIdx]) minIdx = i;
	}
	return loop.slice(minIdx).concat(loop.slice(0, minIdx));
}
