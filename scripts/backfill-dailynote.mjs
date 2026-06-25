#!/usr/bin/env node
/**
 * One-off backfill: set `dailynote: "[[YYYYMMDD]]"` in the frontmatter of every
 * Schema-typed note in a vault, linking the daily note for the note's own day
 * (its `datetime` frontmatter if valid, else the file's creation time).
 *
 * Skips: notes without a recognized `type`, notes whose dailynote is already
 * non-empty, `.obsidian`, and the Templates folder. Periodic notes (daily,
 * weekly, monthly, yearly) are included; a daily note linking to itself is
 * intended.
 *
 * Mutates by text-level line insertion before the closing `---` (or replaces an
 * existing empty `dailynote:` line) so the rest of the YAML never reformats.
 *
 * Usage:
 *   node scripts/backfill-dailynote.mjs <vault-path>           # dry run
 *   node scripts/backfill-dailynote.mjs <vault-path> --write   # apply
 *
 * Run with Obsidian closed.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SKIP_TYPES = new Set();
const SKIP_DIRS = new Set([".obsidian", ".git", ".trash", "Templates"]);

const args = process.argv.slice(2);
const write = args.includes("--write");
const vault = args.find((a) => !a.startsWith("--"));
if (!vault) {
	console.error("usage: node scripts/backfill-dailynote.mjs <vault-path> [--write]");
	process.exit(1);
}

const schemaData = JSON.parse(
	readFileSync(join(vault, ".obsidian/plugins/schema/data.json"), "utf8")
);
const knownTypes = new Set((schemaData.schemas ?? []).map((s) => s.name));
const typeKey = schemaData.typeKey ?? "type";

function* walk(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name)) continue;
			yield* walk(join(dir, entry.name));
		} else if (entry.name.endsWith(".md")) {
			yield join(dir, entry.name);
		}
	}
}

/** Extract the frontmatter lines of a file, or null if it has none. */
function frontmatterBlock(text) {
	if (!text.startsWith("---")) return null;
	const firstNewline = text.indexOf("\n");
	if (firstNewline === -1 || text.slice(0, firstNewline).trim() !== "---") return null;
	const close = text.indexOf("\n---", firstNewline);
	if (close === -1) return null;
	return { start: firstNewline + 1, end: close + 1 }; // [start, end) = yaml lines; end points at the closing `---` line
}

/** Minimal scalar read of a top-level `key: value` line. Good enough for the
 *  string keys this script needs (type, datetime, dailynote). */
function readScalar(yamlText, key) {
	const re = new RegExp(`^${key}:[ \\t]*(.*)$`, "m");
	const m = yamlText.match(re);
	if (!m) return undefined;
	let v = m[1].trim();
	if (
		(v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
		(v.startsWith("'") && v.endsWith("'") && v.length >= 2)
	) {
		v = v.slice(1, -1);
	}
	return v;
}

function dayOf(datetimeStr, filePath) {
	if (typeof datetimeStr === "string" && datetimeStr.trim().length > 0) {
		const d = new Date(datetimeStr);
		if (!Number.isNaN(d.valueOf())) return d;
	}
	const st = statSync(filePath);
	return st.birthtime && st.birthtime.valueOf() > 0 ? st.birthtime : st.mtime;
}

function fmtDay(d) {
	const pad = (n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

let updated = 0;
let skipped = 0;
const counts = {};

for (const path of walk(vault)) {
	const text = readFileSync(path, "utf8");
	const block = frontmatterBlock(text);
	if (!block) {
		skipped++;
		continue;
	}
	const yamlText = text.slice(block.start, block.end);
	const type = readScalar(yamlText, typeKey);
	if (!type || !knownTypes.has(type) || SKIP_TYPES.has(type)) {
		skipped++;
		continue;
	}
	const existing = readScalar(yamlText, "dailynote");
	if (existing !== undefined && existing !== "" && existing !== "null") {
		skipped++;
		continue;
	}

	const day = fmtDay(dayOf(readScalar(yamlText, "datetime"), path));
	const line = `dailynote: "[[${day}]]"`;

	let nextYaml;
	if (existing !== undefined) {
		nextYaml = yamlText.replace(new RegExp(`^dailynote:[ \\t]*.*$`, "m"), line);
	} else {
		nextYaml = yamlText + line + "\n";
	}
	const next = text.slice(0, block.start) + nextYaml + text.slice(block.end);

	updated++;
	counts[type] = (counts[type] ?? 0) + 1;
	console.log(`${write ? "write" : "would write"}: ${path.slice(vault.length + 1)} -> [[${day}]]`);
	if (write) writeFileSync(path, next, "utf8");
}

console.log(`\n${write ? "Updated" : "Would update"} ${updated} notes (skipped ${skipped}).`);
for (const [t, n] of Object.entries(counts).sort()) console.log(`  ${t}: ${n}`);
if (!write) console.log("\nDry run. Re-run with --write to apply.");
