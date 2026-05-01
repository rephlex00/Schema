import { describe, expect, it } from "vitest";
import { parseFileClass, typeNameFromPath } from "../../src/schema/parser";

describe("typeNameFromPath", () => {
	it("strips path and .md extension", () => {
		expect(typeNameFromPath("Templates/Objects/facts/person.md")).toBe("person");
		expect(typeNameFromPath("person.md")).toBe("person");
		expect(typeNameFromPath("Templates/Objects/moments/event.md")).toBe("event");
	});
});

describe("parseFileClass", () => {
	it("returns null when there is no frontmatter", () => {
		expect(parseFileClass("x.md", "no frontmatter here")).toBeNull();
		expect(parseFileClass("x.md", "")).toBeNull();
	});

	it("returns null when frontmatter is unclosed", () => {
		expect(parseFileClass("x.md", "---\ntype: foo\nbody")).toBeNull();
	});

	it("parses a minimal MM-style fileClass", () => {
		const src = `---
extends: fact
icon: user
filesPaths:
  - Facts/People
tagNames:
  - type/person
fields:
  - name: firstname
    type: Input
    id: ab12CD
version: "2.0"
---
`;
		const schema = parseFileClass("Templates/Objects/facts/person.md", src);
		expect(schema).not.toBeNull();
		expect(schema!.name).toBe("person");
		expect(schema!.extends).toBe("fact");
		expect(schema!.folder).toBe("Facts/People");
		expect(schema!.tags).toEqual(["type/person"]);
		expect(schema!.fields).toHaveLength(1);
		expect(schema!.fields[0]!.name).toBe("firstname");
		expect(schema!.fields[0]!.id).toBe("ab12CD");
	});

	it("prefers `folder` over `filesPaths`", () => {
		const src = `---
folder: Facts/Custom
filesPaths:
  - Facts/People
fields: []
---
`;
		const schema = parseFileClass("p.md", src);
		expect(schema!.folder).toBe("Facts/Custom");
	});

	it("prefers `tags` over `tagNames`", () => {
		const src = `---
tags: [type/x]
tagNames:
  - type/y
fields: []
---
`;
		const schema = parseFileClass("x.md", src);
		expect(schema!.tags).toEqual(["type/x"]);
	});

	it("extracts Lookup fields into the lookups list", () => {
		const src = `---
fields:
  - name: events
    type: Lookup
    id: aa11AA
    options:
      dvQueryString: dv.pages('"Moments"').filter(e => true)
      autoUpdate: true
---
`;
		const schema = parseFileClass("p.md", src);
		expect(schema!.lookups).toHaveLength(1);
		expect(schema!.lookups[0]!.name).toBe("events");
		expect(schema!.lookups[0]!.query).toContain("dv.pages");
		expect(schema!.lookups[0]!.autoUpdate).toBe(true);
		expect(schema!.lookups[0]!.render).toBe("frontmatter");
	});

	it("extracts top-level lookups: block", () => {
		const src = `---
fields: []
lookups:
  references:
    query: dv.pages('"Things"').filter(t => true)
    render: block
    output: bullet-list
---
`;
		const schema = parseFileClass("p.md", src);
		expect(schema!.lookups).toHaveLength(1);
		expect(schema!.lookups[0]!.render).toBe("block");
		expect(schema!.lookups[0]!.output).toBe("bullet-list");
	});

	it("normalizes a string-valued tagNames into an array", () => {
		const src = `---
tagNames: type/single
fields: []
---
`;
		const schema = parseFileClass("p.md", src);
		expect(schema!.tags).toEqual(["type/single"]);
	});
});
