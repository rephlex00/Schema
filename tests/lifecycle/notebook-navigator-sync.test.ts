import { describe, expect, it } from "vitest";
import {
	buildPropertyMeta,
	findStalePropertyNodes,
	isTypePropertyInNavigation,
	propertyNodeId,
} from "../../src/lifecycle/notebook-navigator-sync";
import type { TypeSchema } from "../../src/schema/types";

function schema(overrides: Partial<TypeSchema>): TypeSchema {
	return {
		name: "person",
		tags: [],
		fields: [],
		lookups: [],
		defaults: {},
		...overrides,
	};
}

describe("propertyNodeId", () => {
	it("builds a key=value node id", () => {
		expect(propertyNodeId("type", "person")).toBe("key:type=person");
	});

	it("passes names with spaces and case through verbatim", () => {
		expect(propertyNodeId("type", "Org Unit")).toBe("key:type=Org Unit");
	});

	it("respects a custom type key", () => {
		expect(propertyNodeId("kind", "place")).toBe("key:kind=place");
	});
});

describe("buildPropertyMeta", () => {
	it("maps color and icon defaults onto the node, nulling the missing one", () => {
		const result = buildPropertyMeta(
			[
				schema({ name: "person", defaults: { color: "#3b82f6", icon: "user" } }),
				schema({ name: "place", defaults: { color: "#22c55e" } }),
				schema({ name: "org", defaults: { icon: "building-2" } }),
				schema({ name: "blank", defaults: {} }),
			],
			"type"
		);
		expect(result).toEqual([
			{ nodeId: "key:type=person", color: "#3b82f6", icon: "user" },
			{ nodeId: "key:type=place", color: "#22c55e", icon: null },
			{ nodeId: "key:type=org", color: null, icon: "building-2" },
			{ nodeId: "key:type=blank", color: null, icon: null },
		]);
	});

	it("trims values and treats whitespace-only as cleared", () => {
		const [meta] = buildPropertyMeta(
			[schema({ name: "person", defaults: { color: "  #fff  ", icon: "   " } })],
			"type"
		);
		expect(meta).toEqual({ nodeId: "key:type=person", color: "#fff", icon: null });
	});

	it("ignores non-string defaults", () => {
		const [meta] = buildPropertyMeta(
			[schema({ name: "person", defaults: { color: 123, icon: true } as never })],
			"type"
		);
		expect(meta).toEqual({ nodeId: "key:type=person", color: null, icon: null });
	});

	it("includes resolved (inherited) color/icon supplied on the schema", () => {
		// The caller passes resolved schemas, so an inherited color is already on
		// defaults by the time it reaches buildPropertyMeta.
		const [meta] = buildPropertyMeta(
			[schema({ name: "employee", defaults: { color: "#3b82f6", icon: "user" } })],
			"type"
		);
		expect(meta.color).toBe("#3b82f6");
		expect(meta.icon).toBe("user");
	});
});

describe("findStalePropertyNodes", () => {
	it("returns object-type value nodes whose value is no longer a known type", () => {
		const existing = ["key:type=person", "key:type=oldname", "key:type=place"];
		expect(findStalePropertyNodes(existing, "type", ["person", "place"])).toEqual([
			"key:type=oldname",
		]);
	});

	it("ignores other properties and the key-level node", () => {
		const existing = ["key:type", "key:status=done", "key:type=person"];
		expect(findStalePropertyNodes(existing, "type", ["person"])).toEqual([]);
	});

	it("matches case-insensitively (Notebook Navigator stores ids lowercased)", () => {
		const existing = ["key:type=person"];
		// "Person" is the current type; its lowercased node should not be stale.
		expect(findStalePropertyNodes(existing, "type", ["Person"])).toEqual([]);
	});

	it("honors a custom type key", () => {
		const existing = ["key:kind=ghost", "key:type=person"];
		expect(findStalePropertyNodes(existing, "kind", ["place"])).toEqual(["key:kind=ghost"]);
	});
});

describe("isTypePropertyInNavigation", () => {
	const settings = (overrides: Record<string, unknown>) => ({
		vaultProfile: "default",
		vaultProfiles: [{ id: "default", propertyKeys: [] as unknown[] }],
		...overrides,
	});

	it("is true when the type key is a navigation/list property", () => {
		const s = settings({
			vaultProfiles: [
				{ id: "default", propertyKeys: [{ key: "type", showInNavigation: true }] },
			],
		});
		expect(isTypePropertyInNavigation(s, "type")).toBe(true);
	});

	it("is false when the type key isn't enabled in the active profile", () => {
		const s = settings({
			vaultProfiles: [{ id: "default", propertyKeys: [{ key: "status", showInList: true }] }],
		});
		expect(isTypePropertyInNavigation(s, "type")).toBe(false);
	});

	it("assumes enabled when profiles can't be introspected", () => {
		expect(isTypePropertyInNavigation({}, "type")).toBe(true);
		expect(isTypePropertyInNavigation(undefined, "type")).toBe(true);
	});
});
