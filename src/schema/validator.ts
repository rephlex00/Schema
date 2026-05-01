import { detectExtendsCycle } from "./resolve";
import type { TypeSchema, ValidationError, ValidationResult } from "./types";

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
				message: `duplicate field name "${f.name}"`,
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
				message: `lookup "${l.name}" collides with a field name`,
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
 */
export function validateAll(schemas: Map<string, TypeSchema>): ValidationResult {
	const errors: ValidationError[] = [];

	for (const schema of schemas.values()) {
		errors.push(...validateOne(schema));

		if (schema.extends && !schemas.has(schema.extends)) {
			errors.push({
				type: schema.name,
				level: "error",
				message: `extends "${schema.extends}" but no such type is defined`,
			});
		}

		const cycle = detectExtendsCycle(schemas, schema.name);
		if (cycle) {
			errors.push({
				type: schema.name,
				level: "error",
				message: `extends chain cycles: ${cycle.join(" → ")}`,
			});
		}

		for (const f of schema.fields) {
			if (f.target && !schemas.has(f.target)) {
				errors.push({
					type: schema.name,
					level: "warning",
					message: `field "${f.name}" targets "${f.target}" which is not a defined type`,
				});
			}
			if (f.inverse && (!f.target || !schemas.has(f.target))) {
				errors.push({
					type: schema.name,
					level: "warning",
					message: `field "${f.name}" has inverse "${f.inverse}" but target "${f.target ?? "(unset)"}" is not a defined type — synthesis will be skipped`,
				});
			}
		}
	}

	// Detect inverse-name collisions on the SAME target across different sources.
	const inverseClaims = new Map<string, string[]>(); // key: `${target}::${inverseName}` → source type names
	for (const schema of schemas.values()) {
		for (const f of schema.fields) {
			if (!f.inverse || !f.target || !schemas.has(f.target)) continue;
			const key = `${f.target}::${f.inverse}`;
			const claimers = inverseClaims.get(key) ?? [];
			claimers.push(schema.name);
			inverseClaims.set(key, claimers);
		}
	}
	for (const [key, claimers] of inverseClaims) {
		if (claimers.length > 1) {
			const [target, inverseName] = key.split("::");
			errors.push({
				type: target,
				level: "error",
				message: `multiple types claim inverse "${inverseName}" on "${target}": ${claimers.join(", ")} — only one will be synthesized`,
			});
		}
	}

	// Warn when synthesized inverse name collides with a manual lookup on the target.
	for (const [key, claimers] of inverseClaims) {
		const [target, inverseName] = key.split("::");
		const targetSchema = schemas.get(target);
		if (!targetSchema) continue;
		if (targetSchema.lookups.some((l) => l.name === inverseName)) {
			errors.push({
				type: target,
				level: "warning",
				message: `manual lookup "${inverseName}" shadows the inverse synthesized by ${claimers.join(", ")}`,
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
					message: `tag "${tag}" is also declared by type "${existing}"`,
				});
			} else {
				tagOwner.set(tag, schema.name);
			}
		}
	}

	const hasError = errors.some((e) => e.level === "error");
	return { ok: !hasError, errors };
}
