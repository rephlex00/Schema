# Changelog

All notable changes to the Schema plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Sync graph colors to type colors.** A new command (*Sync graph colors to
  type colors*) and Settings → Schema → Graph view → *Sync now* button writes
  each type's `color` default into the global graph view's color groups,
  matching notes by their `type:` property (e.g. `[type:person]`). Colors are
  resolved through the `extends` chain - a type with no color of its own uses
  its ancestor's, so the graph matches the color shown on the note's
  banner/chip. Manual color groups you've added (`tag:`, `path:`,
  `[subtype:…]`, …) are preserved; the sync is idempotent and only runs when
  you trigger it. Open graph views update live.

### Breaking
- **Date tokens use Obsidian moment.js form.** Replaced the legacy
  `{{__year}}`, `{{__month}}`, `{{__day}}`, `{{__hour}}`, `{{__minute}}`,
  `{{__week}}`, and `{{__timestamp}}` placeholders with
  `{{date:YYYY}}`, `{{date:MM}}`, `{{date:DD}}`, `{{date:HH}}`,
  `{{date:mm}}`, `{{date:WW}}`, and `{{date:YYYYMMDD-HHmm}}` respectively.
  The old underscore tokens are no longer resolved. Existing folder/filename
  templates referencing them must be updated.

### Changed
- **Lookups UX: split into Backlinks + Custom lookups.** The per-type
  "Lookups" section is now two siblings: a *Backlinks* subsection (cards,
  one per `inverse:`-derived lookup) and a collapsed *Custom lookups*
  subsection for hand-written Dataview queries. Each Backlinks card shows
  a plain-English description (e.g. "Backlinks from `person` notes via
  their `organization` property"), a live sample of the top 5 matching
  notes, a one-click button that jumps to the source global property that
  created the backlink, and a per-backlink "frontmatter / inline block"
  toggle persisted as `TypeSchema.backlinkOverrides`. The raw-query
  preview is gone. The global-property editor's "Reverse-link name on the
  target" field is renamed to *Backlinks name* and renders a cause-effect
  status line ("→ Creates a `members` backlinks list on [organization]")
  that links back to the target type editor. The Custom lookups editor
  gains a live "Where this lands" hint per row (e.g. "Writes a
  comma-separated wikilink list to the note's `recent_moments`
  property.") and an inline *Open query playground* button.
- **Redesigned Settings → Schema as a landing + sub-pages layout.** The four
  top-level tabs (Global Settings, Global Fields, Objects, Appearance) are
  replaced by a landing page that groups ten focused sub-pages under
  *Lifecycle*, *Properties*, *Structure*, *Appearance*, and *Advanced*. Each
  sub-page opens with a back-arrow and a tight, mobile-aware layout:
  full-width inputs, stacked folder-mapping rows, 44px touch targets on
  phones. Descriptions throughout were trimmed. Validation badge now hangs
  on the *Object types* landing row instead of a tab button.
- Nested types in the Settings → Schema → Object types tree render with
  continuous vertical guide rails, one per ancestor depth, so inheritance
  chains read cleanly at a glance.
- **Settings UX pass.** Reordered sections to Structure → Properties →
  Lifecycle → Appearance → Advanced. Renamed user-facing "type" to
  "object type" throughout labels, descriptions, command names, tooltips,
  and validation messages. Pane renames: Folder → type mappings →
  *Folder → Object mappings*; Global fields → *Global properties*;
  Banner, chip, and file icons → *UI elements*; Query engine →
  *Query and templating engines*. Em-dashes removed from all UI strings.
  Path inputs (templates folder, folder mappings, type folder) now offer
  fuzzy folder/file suggestions.

### Added
- **Configurable object-type frontmatter key.** A new top-of-pane setting
  (Structure → Object types → *Object-type property*) controls which
  frontmatter key Schema reads to identify a note's object type. Default
  `type`. Threaded through every read and write site; descriptions that
  reference the literal `type:` token now interpolate the configured key.
  Changing the key is forward-only: existing notes keep their old key.
- **Save to / Load from template.** The Body template row on the per-object-
  type editor now sports two buttons. *Save to template* writes the object
  type's property list (in order, with defaults) into the template file's
  frontmatter, preserving the Templater body. *Load from template* replaces
  the object type's property list with what's in the template's frontmatter,
  adding new global properties for keys that don't exist yet. Both buttons
  are disabled when the two sides agree; a diff hint shows what differs
  when they don't. Property data types round-trip via Obsidian's rough
  property types (text, number, checkbox, date, datetime, list).
- **Inline greyed-out inherited properties.** Properties inherited from a
  parent object type now render inline in the property list, greyed and
  read-only, with a link icon that opens the parent. Display-only reordering
  persists to a per-type `inheritedOrder`.
- **Remove-property scope modal.** Removing an owned property opens a
  confirmation modal showing how many existing notes of this object type
  currently carry the property, with a choice to leave them alone or strip
  the key from every affected note.
- **Real UI previews on appearance toggles.** The Banner / Chip / File-list
  icon toggles render live sample elements (using the same CSS as the
  features themselves) instead of ASCII boxes.
- **Templater status row.** The Advanced pane now shows Templater
  availability alongside Dataview. When Templater is missing, the Lifecycle
  → Templates *Auto-pick body template* toggle and the per-object-type
  *Body template* input + Save/Load buttons disable themselves with a
  notice.
- **Global property polish.** Each global property's expanded card has a
  faint background, the data-type picker is now Obsidian's native dropdown
  with a right-aligned description, and a *Used by* line lists every object
  type that references the property.
- **Custom-filters worked example.** A collapsible *How custom filters
  work* block sits at the top of the pane with an "initials" example and a
  one-paragraph explainer.
- **Auto-refreshed properties simplified.** Removed up/down reorder
  buttons and the redundant "kind" picker (renderer now derives from the
  matching Global property's data type or the property name). Added a
  column header row and a "Used by" count per row. Trash icon replaces ×.

## [2.0.0] - 2026-05-01

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

## [1.0.0] - 2026-04-30

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
  icon, and color per type - writes back to source YAML via processFrontMatter.
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
- `schemaFolder` - vault-relative folder containing fileClass definitions
  (default: `Templates/Objects`)
- `autoReshelveOnTypeChange` - toggle the type-change watcher (default: on)

### Tests
- 33 unit tests (parser, validator, liquid renderer, frontmatter builder)
  via Vitest. `npm test` runs the full suite.

### Schema format extensions
Additive on top of Metadata Menu's existing fileClass shape:
- `folder:` (replaces `filesPaths:`)
- `filename:` (liquid template, e.g. `"{{firstname}} {{lastname}}"`)
- `tags:` (replaces `tagNames:`)
- `fields[*].promptOnCreate:` - prompt label for the New flow
- `fields[*].target:` - constrains MultiFile/File pickers to a fileClass
- `lookups[*].render:` - `frontmatter` or `block`
- `lookups[*].output:` - `list`, `bullet-list`, or `count`

Existing MM fileClasses load unchanged.

## [0.1.0] - 2026-04-30

### Added
- Initial repo scaffold: manifest, esbuild build pipeline, TypeScript strict-mode config.
- `Schema: Hello` command for build-pipeline validation.
