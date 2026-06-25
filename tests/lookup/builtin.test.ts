import { describe, expect, it } from "vitest";
import type { TFile } from "obsidian";
import { BuiltinRuntime } from "../../src/lookup/runtime/builtin";
import { createMockApp } from "../__helpers__/mock-app";

function setup() {
	const h = createMockApp();
	// A small "Moments" folder with mixed types and links back to a person.
	h.addFile("Moments/2024/party.md", {
		type: "event",
		attendees: [{ path: "Facts/People/Alice.md" }, { path: "Facts/People/Bob.md" }],
	});
	h.addFile("Moments/2024/lunch.md", {
		type: "event",
		attendees: [{ path: "Facts/People/Bob.md" }],
	});
	h.addFile("Moments/2024/note.md", { type: "journal" });
	h.addFile("Facts/People/Alice.md", { type: "person" });
	h.addFile("Facts/People/Bob.md", { type: "person" });
	const runtime = new BuiltinRuntime(h.app as never);
	return { h, runtime };
}

describe("BuiltinRuntime", () => {
	it("filters pages in a folder by frontmatter equality", async () => {
		const { h, runtime } = setup();
		const current = h.get("Facts/People/Alice.md")!;
		const result = await runtime.run(
			`dv.pages('"Moments"').filter(m => m.type === "event")`,
			current as unknown as TFile
		);
		const paths = result.files.map((f) => f.path).sort();
		expect(paths).toEqual(["Moments/2024/lunch.md", "Moments/2024/party.md"]);
	});

	it("resolves an inverse-style link query against current.file.path", async () => {
		const { h, runtime } = setup();
		const alice = h.get("Facts/People/Alice.md")!;
		// Mirrors a synthesized inverse lookup: events whose attendees include me.
		const query = `dv.pages('"Moments"').filter(s => s.type === "event" && s.attendees && s.attendees.some(p => p.path === current.file.path))`;
		const result = await runtime.run(query, alice as unknown as TFile);
		// Only the party has Alice.
		expect(result.files.map((f) => f.path)).toEqual(["Moments/2024/party.md"]);

		const bob = h.get("Facts/People/Bob.md")!;
		const resultBob = await runtime.run(query, bob as unknown as TFile);
		expect(resultBob.files.map((f) => f.path).sort()).toEqual([
			"Moments/2024/lunch.md",
			"Moments/2024/party.md",
		]);
	});

	it("supports boolean composition (&&, ||) inside the predicate", async () => {
		const { h, runtime } = setup();
		const current = h.get("Facts/People/Alice.md")!;
		const result = await runtime.run(
			`dv.pages('"Moments"').filter(m => m.type === "event" || m.type === "journal")`,
			current as unknown as TFile
		);
		expect(result.files.length).toBe(3);
	});

	it("matches a File field stored as a wikilink string against current.file.path", async () => {
		const h = createMockApp();
		h.addFile("Facts/People/Alice.md", { type: "person" });
		h.addFile("Facts/People/Bob.md", { type: "person" });
		// File values are persisted as wikilink strings, not Link objects.
		h.addFile("Moments/2024/party.md", { type: "event", host: "[[Facts/People/Alice]]" });
		h.addFile("Moments/2024/lunch.md", { type: "event", host: "[[Facts/People/Bob]]" });
		const runtime = new BuiltinRuntime(h.app as never);
		const alice = h.get("Facts/People/Alice.md")!;
		const query = `dv.pages('"Moments"').filter(s => s.type === "event" && s.host && s.host.path === current.file.path)`;
		const result = await runtime.run(query, alice as unknown as TFile);
		expect(result.files.map((f) => f.path)).toEqual(["Moments/2024/party.md"]);
	});

	it("matches a MultiFile array of wikilink strings", async () => {
		const h = createMockApp();
		h.addFile("Facts/People/Alice.md", { type: "person" });
		h.addFile("Moments/2024/party.md", {
			type: "event",
			attendees: ["[[Facts/People/Alice]]", "[[Facts/People/Bob]]"],
		});
		h.addFile("Moments/2024/lunch.md", { type: "event", attendees: ["[[Facts/People/Bob]]"] });
		const runtime = new BuiltinRuntime(h.app as never);
		const alice = h.get("Facts/People/Alice.md")!;
		const query = `dv.pages('"Moments"').filter(s => s.type === "event" && s.attendees && s.attendees.some(p => p.path === current.file.path))`;
		const result = await runtime.run(query, alice as unknown as TFile);
		expect(result.files.map((f) => f.path)).toEqual(["Moments/2024/party.md"]);
	});

	it("scans the whole vault for a no-arg dv.pages()", async () => {
		const h = createMockApp();
		h.addFile("People/Alice.md", { type: "person" });
		h.addFile("A/one.md", { type: "event" });
		h.addFile("B/two.md", { type: "event" });
		h.addFile("C/three.md", { type: "journal" });
		const runtime = new BuiltinRuntime(h.app as never);
		const alice = h.get("People/Alice.md")!;
		const result = await runtime.run(
			`dv.pages().filter(s => s.type === "event")`,
			alice as unknown as TFile
		);
		expect(result.files.map((f) => f.path).sort()).toEqual(["A/one.md", "B/two.md"]);
	});

	it("scans a folder union dv.pages('\"A\" or \"B\"')", async () => {
		const h = createMockApp();
		h.addFile("People/Alice.md", { type: "person" });
		h.addFile("A/one.md", { type: "event" });
		h.addFile("B/two.md", { type: "event" });
		h.addFile("C/three.md", { type: "event" });
		const runtime = new BuiltinRuntime(h.app as never);
		const alice = h.get("People/Alice.md")!;
		const result = await runtime.run(
			`dv.pages('"A" or "B"').filter(s => s.type === "event")`,
			alice as unknown as TFile
		);
		expect(result.files.map((f) => f.path).sort()).toEqual(["A/one.md", "B/two.md"]);
	});

	it("throws a clear error when the query is not a dv.pages(...).filter(...) shape", async () => {
		const { h, runtime } = setup();
		const current = h.get("Facts/People/Alice.md")!;
		await expect(
			runtime.run(`dv.pages("Moments").map(m => m)`, current as unknown as TFile)
		).rejects.toThrow();
	});

	it("isolates a per-page filter error without failing the whole query", async () => {
		const { h, runtime } = setup();
		const current = h.get("Facts/People/Alice.md")!;
		// Accessing a method on a possibly-undefined field; pages without it throw
		// inside the predicate and are skipped, not fatal.
		const result = await runtime.run(
			`dv.pages('"Moments"').filter(m => m.attendees.length > 0)`,
			current as unknown as TFile
		);
		// party + lunch have attendees; note throws (no attendees) and is skipped.
		expect(result.files.map((f) => f.path).sort()).toEqual([
			"Moments/2024/lunch.md",
			"Moments/2024/party.md",
		]);
	});
});
