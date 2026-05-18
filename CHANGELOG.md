# Changelog

All notable changes to the Schema plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Breaking
- **Date tokens use Obsidian moment.js form.** Replaced the legacy
  `{{__year}}`, `{{__month}}`, `{{__day}}`, `{{__hour}}`, `{{__minute}}`,
  `{{__week}}`, and `{{__timestamp}}` placeholders with
  `{{date:YYYY}}`, `{{date:MM}}`, `{{date:DD}}`, `{{date:HH}}`,
  `{{date:mm}}`, `{{date:WW}}`, and `{{date:YYYYMMDD-HHmm}}` respectively.
  The old underscore tokens are no longer resolved. Existing folder/filename
  templates referencing them must be updated.

### Changed
- Nested types in the Settings → Objects tree now render with continuous
  vertical guide rails, one per ancestor depth, so inheritance chains read
  cleanly at a glance.

## [2.0.0] — 2026-05-01

### Breaking
- **Source of truth flipped from filesystem to plugin settings.** The plugin no
  longer reads `Templates/Objects/*.md` YAML. All type definitions live in
  `data.json` and are managed through Settings → Schema.
- Old commands removed: `Schema: Reload schemas`, `Schema: Migrate lookups to
  block mode` (lookup render mode is toggled per-lookup in the UI now).
- Old setting removed: `schemaFolder`. Replaced by `schemas: TypeSchema[]` and
  `autoRefreshedFields: string[]`.

### Added
- **Settings → Schema tab is the full editor.** Global section (auto-reshelve
  toggle, auto-refreshed-fields list, lookup runtime indicator), validation
  issues, type list with collapsible per-type editors, "+ Add type" button.
- **Per-type editor** with Basics (extends/folder/filename/tags), Defaults
  (dynamic inputs per `autoRefreshedFields`), Fields (inline-expand rows with
  type-aware widgets, up/down reorder, add/remove), Lookups (per-lookup
  inline-expand: name/query/render/output/autoUpdate, reorder, add/remove),
  Delete-type button.
- **`autoRefreshedFields` global list.** A configurable set of frontmatter keys
  (default `["icon", "color"]`) that get reset to schema defaults on every type
  change. Add `summary` if you want it auto-reset; add any other key the user
  wants pinned to the type.
- `__week` variable in the create-flow render context for ISO-week filename
  templates (e.g. `{{__year}}{{__month}}-W{{__week}}` for weekly).
- `loader.add()` / `remove()` / `update()` / `setAll()` APIs for the Settings
  UI to commit edits granularly.

### Changed
- `TypeSchema` shape slimmed: dropped `sourcePath`, `raw`, `fieldsOrder`, MM-
  compat keys (`filesPaths`, `tagNames`, `mapWithTag`, `limit`). Added
  `defaults: Record<string, unknown>` map.
- `FieldSchema` dropped `id` field (array order is display order).
- `cleanFrontmatter` and `buildFrontmatter` now consume the `defaults` map and
  the global `autoRefreshedFields` list instead of hard-coded `icon`/`color`.
- Validation simplified: tracks duplicate names, lookup-vs-field collisions,
  extends-resolves, target-resolves, tag uniqueness across types.

### Removed
- `src/schema/parser.ts` (no YAML parsing at runtime).
- `migrateLookupsToBlock` helper (lookup render mode is per-lookup now).
- File-watching listeners (`vault.on()`).

### Tests
- 35 unit tests (loader, validator, liquid renderer, frontmatter builder).
- `tests/__mocks__/obsidian.ts` provides a minimal stub of Obsidian's `Events`
  class so loader tests run in plain Node.

## [1.0.0] — 2026-04-30

### Added (full lifecycle)
- **SchemaLoader**: parses extended fileClass YAML in `Templates/Objects/`,
  validates structure and cross-type references, caches in memory, watches for
  file changes (debounced), emits `schema-loaded` and `schema-changed` events.
- **CreateCommandRegistry**: registers one `Schema: New <type>` command per
  instantiable type (any with a `folder:` set). Prompts for fields with
  `promptOnCreate`, renders filename via liquid template, places in folder,
  opens new note. Replaces the Templater Folder Templates / QuickAdd type
  choices.
- **TypeChangeWatcher**: listens to `metadataCache.on("changed")`. When a
  note's `type:` value changes, atomically reshelves to the new folder and
  cleans frontmatter to match the new schema. Self-loop guard via inFlight
  set, gated by `autoReshelveOnTypeChange` setting.
- **LookupEngine**: per-Lookup choice between writing results to YAML
  (frontmatter mode) and rendering as live `schema-lookup` code blocks in the
  note body. Dataview runtime when installed; built-in restricted-subset
  fallback otherwise (handles `dv.pages('"FOLDER"').filter(...)` plus a Luxon
  shim for `fromFormat/toFormat` date math).
- **SchemaSettingsTab**: in-app type browser. Edit folder, filename template,
  icon, and color per type — writes back to source YAML via processFrontMatter.
- **FieldEditModal**: per-field-type editor widgets (text, number, toggle,
  dropdown sourced from `valuesListNotePath`, fuzzy file picker scoped to
  target fileClass, multiline YAML, Lookup result preview). Replaces Metadata
  Menu's field-edit UI.

### Commands
- `Schema: New <type>` (one per instantiable type)
- `Schema: Reload schemas`
- `Schema: Show loaded types`
- `Schema: Refresh frontmatter lookups (vault-wide)`
- `Schema: Migrate lookups to block mode`
- `Schema: Reshelve and clean active file`
- `Schema: Edit field`

### Settings
- `schemaFolder` — vault-relative folder containing fileClass definitions
  (default: `Templates/Objects`)
- `autoReshelveOnTypeChange` — toggle the type-change watcher (default: on)

### Tests
- 33 unit tests (parser, validator, liquid renderer, frontmatter builder)
  via Vitest. `npm test` runs the full suite.

### Schema format extensions
Additive on top of Metadata Menu's existing fileClass shape:
- `folder:` (replaces `filesPaths:`)
- `filename:` (liquid template, e.g. `"{{firstname}} {{lastname}}"`)
- `tags:` (replaces `tagNames:`)
- `fields[*].promptOnCreate:` — prompt label for the New flow
- `fields[*].target:` — constrains MultiFile/File pickers to a fileClass
- `lookups[*].render:` — `frontmatter` or `block`
- `lookups[*].output:` — `list`, `bullet-list`, or `count`

Existing MM fileClasses load unchanged.

## [0.1.0] — 2026-04-30

### Added
- Initial repo scaffold: manifest, esbuild build pipeline, TypeScript strict-mode config.
- `Schema: Hello` command for build-pipeline validation.
