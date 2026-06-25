// Frontmatter YAML (de)serialization.
//
// We use the actively-maintained, dependency-free `yaml` package rather than
// Obsidian's parseYaml/stringifyYaml because the latter don't expose the dump
// options faithful frontmatter serialization needs. The options below reproduce
// the behavior the plugin relied on previously:
//
// - version "1.1": parse unquoted ISO dates as `Date` instances (matching how
//   Obsidian treats date properties) and round-trip them back as bare
//   `YYYY-MM-DD`, not verbose ISO timestamps.
// - lineWidth 0: never wrap long scalars. A wrapped value would reflow users'
//   notes and can confuse frontmatter parsers.
// - aliasDuplicateObjects false: never emit YAML anchors/aliases (`&a` / `*a`)
//   for repeated values; write them out in full.
// - keys keep insertion order (the package does not sort by default), so a
//   note's property order is preserved.
import { parse, stringify } from "yaml";

/** Parse a YAML document (a frontmatter block's inner text). Returns whatever
 *  the document holds (object, array, scalar, null). */
export function parseFrontmatterYaml(text: string): unknown {
	return parse(text, { version: "1.1" });
}

/** Serialize a value as a YAML document for a frontmatter block. Always ends
 *  with a trailing newline. */
export function dumpFrontmatterYaml(value: unknown): string {
	return stringify(value, { version: "1.1", lineWidth: 0, aliasDuplicateObjects: false });
}
