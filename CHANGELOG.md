# Changelog

All notable changes to the Schema plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
