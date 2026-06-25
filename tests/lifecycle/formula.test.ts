import { describe, expect, it } from "vitest";
import type { TFile } from "obsidian";
import { evaluateFormula } from "../../src/lifecycle/formula";
import { createMockApp } from "../__helpers__/mock-app";

describe("evaluateFormula", () => {
	it("concatenates frontmatter fields", () => {
		const h = createMockApp();
		const file = h.addFile("Facts/People/Alice.md", { firstname: "Alice", lastname: "Stone" });
		const out = evaluateFormula(
			h.app as never,
			file as unknown as TFile,
			"fm.firstname + ' ' + fm.lastname"
		);
		expect(out).toBe("Alice Stone");
	});

	it("exposes file.path and file.name", () => {
		const h = createMockApp();
		const file = h.addFile("Facts/People/Alice.md", {});
		expect(evaluateFormula(h.app as never, file as unknown as TFile, "file.name")).toBe("Alice");
		expect(evaluateFormula(h.app as never, file as unknown as TFile, "file.path")).toBe(
			"Facts/People/Alice.md"
		);
	});

	it("stringifies object results as JSON", () => {
		const h = createMockApp();
		const file = h.addFile("x.md", {});
		expect(evaluateFormula(h.app as never, file as unknown as TFile, "({a:1})")).toBe('{"a":1}');
	});

	it("returns empty string for null/undefined results", () => {
		const h = createMockApp();
		const file = h.addFile("x.md", {});
		expect(evaluateFormula(h.app as never, file as unknown as TFile, "fm.nope")).toBe("");
	});

	it("returns an !err: message instead of throwing on a bad expression", () => {
		const h = createMockApp();
		const file = h.addFile("x.md", {});
		const out = evaluateFormula(h.app as never, file as unknown as TFile, "fm.a.b.c");
		expect(out.startsWith("!err:")).toBe(true);
	});

	it("computes numeric expressions over frontmatter", () => {
		const h = createMockApp();
		const file = h.addFile("x.md", { miles: 3 });
		expect(evaluateFormula(h.app as never, file as unknown as TFile, "fm.miles * 1.60934")).toBe(
			"4.82802"
		);
	});
});
