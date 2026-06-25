import { describe, expect, it } from "vitest";
import type { TFile } from "obsidian";
import { resolveFolder, reshelveToSchema } from "../../src/lifecycle/reshelve";
import type { TypeSchema } from "../../src/schema/types";
import { createMockApp } from "../__helpers__/mock-app";

function schema(overrides: Partial<TypeSchema>): TypeSchema {
	return { name: "person", tags: [], fields: [], lookups: [], defaults: {}, ...overrides };
}

describe("resolveFolder", () => {
	it("returns a plain folder unchanged", () => {
		expect(resolveFolder(schema({ folder: "Facts/People" }), {})).toBe("Facts/People");
	});

	it("returns null when no folder is set", () => {
		expect(resolveFolder(schema({ folder: undefined }), {})).toBeNull();
	});

	it("trims trailing slashes", () => {
		expect(resolveFolder(schema({ folder: "Facts/People/" }), {})).toBe("Facts/People");
	});

	it("substitutes frontmatter values into a templated folder", () => {
		expect(
			resolveFolder(schema({ folder: "Projects/{{client}}" }), { client: "Acme" })
		).toBe("Projects/Acme");
	});

	it("renders a date-token folder using the __now context value (deterministic)", () => {
		const fm = { __now: new Date("2024-07-15T12:00:00") };
		expect(resolveFolder(schema({ folder: "Moments/{{date:YYYY}}" }), fm)).toBe("Moments/2024");
	});

	it("returns null when a template renders to empty", () => {
		expect(resolveFolder(schema({ folder: "{{missing}}" }), {})).toBeNull();
	});
});

describe("reshelveToSchema", () => {
	it("moves a file into the schema folder when it is elsewhere", async () => {
		const h = createMockApp();
		const file = h.addFile("Inbox/Alice.md", { type: "person" });
		const result = await reshelveToSchema(
			h.app as never,
			file as unknown as TFile,
			schema({ folder: "Facts/People" }),
			{}
		);
		expect(result).toEqual({ from: "Inbox/Alice.md", to: "Facts/People/Alice.md" });
		expect(file.path).toBe("Facts/People/Alice.md");
		expect(h.get("Facts/People/Alice.md")).toBeDefined();
		expect(h.get("Inbox/Alice.md")).toBeUndefined();
	});

	it("is a no-op when the file is already in the right folder", async () => {
		const h = createMockApp();
		const file = h.addFile("Facts/People/Bob.md", { type: "person" });
		const result = await reshelveToSchema(
			h.app as never,
			file as unknown as TFile,
			schema({ folder: "Facts/People" }),
			{}
		);
		expect(result).toEqual({ from: "Facts/People/Bob.md", to: "Facts/People/Bob.md" });
		expect(file.path).toBe("Facts/People/Bob.md");
	});

	it("returns null when the schema has no folder (abstract type)", async () => {
		const h = createMockApp();
		const file = h.addFile("Anywhere/Carol.md", { type: "fact" });
		const result = await reshelveToSchema(
			h.app as never,
			file as unknown as TFile,
			schema({ name: "fact", folder: undefined }),
			{}
		);
		expect(result).toBeNull();
		expect(file.path).toBe("Anywhere/Carol.md");
	});

	it("creates the destination folder if it does not yet exist", async () => {
		const h = createMockApp();
		const file = h.addFile("Inbox/Dave.md", { type: "person" });
		await reshelveToSchema(
			h.app as never,
			file as unknown as TFile,
			schema({ folder: "Facts/NewlyCreated" }),
			{}
		);
		expect(h.folders()).toContain("Facts/NewlyCreated");
	});

	it("disambiguates instead of overwriting an existing note at the destination", async () => {
		const h = createMockApp();
		const existing = h.addFile("Facts/People/Alice.md", { type: "person" });
		const incoming = h.addFile("Inbox/Alice.md", { type: "person" });
		const result = await reshelveToSchema(
			h.app as never,
			incoming as unknown as TFile,
			schema({ folder: "Facts/People" }),
			{}
		);
		expect(result).toEqual({ from: "Inbox/Alice.md", to: "Facts/People/Alice 2.md" });
		// Original note is untouched; the incoming note lands at a unique path.
		expect(h.get("Facts/People/Alice.md")).toBe(existing);
		expect(h.get("Facts/People/Alice 2.md")).toBeDefined();
		expect(h.get("Inbox/Alice.md")).toBeUndefined();
	});

	it("routes into a date-templated folder using frontmatter context", async () => {
		const h = createMockApp();
		const file = h.addFile("Inbox/diary.md", {
			type: "moment",
			__now: new Date("2023-03-09T09:00:00"),
		});
		const result = await reshelveToSchema(
			h.app as never,
			file as unknown as TFile,
			schema({ name: "moment", folder: "Moments/{{date:YYYY}}" }),
			{ __now: new Date("2023-03-09T09:00:00") }
		);
		expect(result?.to).toBe("Moments/2023/diary.md");
	});
});
