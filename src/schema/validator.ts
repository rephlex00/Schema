import type { TypeSchema, ValidationError, ValidationResult } from "./types";

/**
 * Validate a single TypeSchema in isolation (no cross-type checks).
 *
 * Checks:
 * - Field IDs are unique within the type
 * - Every entry in `fieldsOrder` corresponds to a defined field
 * - Every defined field appears in `fieldsOrder` (warning, not error)
 */
export function validateOne(schema: TypeSchema): ValidationError[] {
	const errors: ValidationError[] = [];
	const seenIds = new Set<string>();
	const seenNames = new Set<string>();

	for (const f of schema.fields) {
		if (seenIds.has(f.id)) {
			errors.push({
				type: schema.name,
				level: "error",
				message: `duplicate field id "${f.id}" (also used by "${[...seenIds].find((i) => i === f.id)}")`,
			});
		} else {
			seenIds.add(f.id);
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

	if (schema.fieldsOrder) {
		const fieldIdSet = new Set(schema.fields.map((f) => f.id));
		for (const id of schema.fieldsOrder) {
			if (!fieldIdSet.has(id)) {
				errors.push({
					type: schema.name,
					level: "warning",
					message: `fieldsOrder references unknown field id "${id}"`,
				});
			}
		}
		const orderSet = new Set(schema.fieldsOrder);
		for (const f of schema.fields) {
			if (!orderSet.has(f.id)) {
				errors.push({
					type: schema.name,
					level: "warning",
					message: `field "${f.name}" (id ${f.id}) is not listed in fieldsOrder`,
				});
			}
		}
	}

	return errors;
}

/**
 * Validate the full schema set, including cross-type references.
 *
 * Cross-type checks:
 * - `extends` references a known type
 * - Field `target` (for File/MultiFile) references a known type
 * - No two types declare the same `tag` value
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

		for (const f of schema.fields) {
			if (f.target && !schemas.has(f.target)) {
				errors.push({
					type: schema.name,
					level: "warning",
					message: `field "${f.name}" targets "${f.target}" which is not a defined type`,
				});
			}
		}
	}

	// Cross-type tag uniqueness
	const tagOwner = new Map<string, string>();
	for (const schema of schemas.values()) {
		for (const tag of schema.tags ?? []) {
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
