#!/usr/bin/env node
//
// CalVer version bumper for the Schema plugin.
//
// Format: YYYY.M.RELEASE
//   YYYY    - current year
//   M       - current month (1–12, NO leading zero so the result stays
//             semver-compliant for package.json)
//   RELEASE - counter that bumps every deploy. Resets to 1 when the
//             month rolls over (or when the prior version isn't CalVer
//             yet, e.g. the first run after switching from semver).
//
// Updates manifest.json (Obsidian reads this), package.json (npm
// expects valid semver here), and versions.json (Obsidian's
// minAppVersion-per-version map).
//
// Run via `npm run deploy` - no flags, no thinking.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(root, "manifest.json");
const pkgPath = join(root, "package.json");
const versionsPath = join(root, "versions.json");

const now = new Date();
const year = now.getFullYear();
const month = now.getMonth() + 1;

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const previous = String(manifest.version ?? "");
const match = /^(\d{4})\.(\d{1,2})\.(\d+)$/.exec(previous);

const sameMonth =
	match && Number(match[1]) === year && Number(match[2]) === month;
const release = sameMonth ? Number(match[3]) + 1 : 1;
const next = `${year}.${month}.${release}`;

manifest.version = next;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

const versions = existsSync(versionsPath)
	? JSON.parse(readFileSync(versionsPath, "utf8"))
	: {};
versions[next] = manifest.minAppVersion ?? "1.4.0";
writeFileSync(versionsPath, JSON.stringify(versions, null, 2) + "\n");

console.log(`[schema] version ${previous} → ${next}`);
