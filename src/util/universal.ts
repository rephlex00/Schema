import type { FieldSchema, TypeSchema } from "../schema/types";

/**
 * Global properties flagged `universal` are included in every object type
 * without being listed in each type's `fields`. They're applied at consumption
 * points (frontmatter build, clean/reshelve, body templates) rather than being
 * persisted onto each schema.
 */
export function getUniversalFields(
	globalFields: Record<string, FieldSchema>
): FieldSchema[] {
	return Object.values(globalFields).filter((f) => f.universal === true);
}

/**
 * A type's effective property set: its own declared fields plus universal
 * globals it doesn't already declare. Deduped by name; a field the type
 * declares directly wins over the universal of the same name.
 */
export function effectiveFields(
	schema: TypeSchema,
	universal: FieldSchema[]
): FieldSchema[] {
	const ownNames = new Set(schema.fields.map((f) => f.name));
	const extra = universal.filter((u) => !ownNames.has(u.name));
	return [...schema.fields, ...extra];
}
