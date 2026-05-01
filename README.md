# Schema

A typed-note workflow for Obsidian. Define object types in the plugin settings; get auto-reshelve on `type:` change, native lookups (frontmatter or inline blocks), creation commands per type, and one source of truth for schema, folder, filename, prompts, and visual defaults.

## Why

A typical typed-note workflow in Obsidian today threads through four plugins:

| Concern | Plugin |
|---|---|
| What fields does a `person` have? | Metadata Menu (fileClass) |
| Where do `person` files live? | Workflow Objects (`pathMappings`) |
| How does a new `person` get created? | Templater + QuickAdd |
| What happens when you change `type:`? | Two manual commands |

Schema collapses all of that into one source of truth (the plugin's Settings → Schema tab) and ships the lifecycle as native subsystems.

## Defining a type

**Settings → Schema → "+ Add type"**. Each type expands inline:

- **Basics**: name, extends, folder, filename template, tags
- **Defaults**: per-type values for whichever frontmatter keys you've designated as auto-refreshed (icon and color by default; configurable globally)
- **Fields**: inline-expand rows, type-aware widgets (Input, Number, Boolean, Select, MultiFile/File with target type, Date/Time, etc.), with `promptOnCreate` labels for the create flow
- **Lookups**: dataview-style queries with per-lookup choice of frontmatter or live block rendering

That's it. No YAML files to edit, no JSON to hand-write.

## Lifecycle

When you change a note's `type:` value (typing it directly or applying a `#type/<name>` tag), the plugin atomically:
1. Moves the file to the new type's folder
2. Strips frontmatter keys not in the new schema
3. Adds empty placeholders for missing required fields
4. Resets auto-refreshed fields (icon, color) from the new type's defaults

When you run `Schema: New <type>` from the command palette:
1. The plugin prompts for any field with `promptOnCreate`
2. Renders the filename template
3. Places the file in the configured folder
4. Opens it

## Lookup output modes

**Frontmatter mode**: result is written into the entity note's YAML.

```yaml
moments_with_me:
  - "[[Moments/2026/20260425-0000|Durham Family Day]]"
  - "[[Moments/2026/20260321-1519|Obsidian Plugin Idea]]"
```

**Block mode**: place a code block in the note body; the plugin renders the result live.

````markdown
## Moments

```schema-lookup
moments_with_me
```
````

The block re-renders as data changes; no frontmatter writes, no git noise.

## Auto-refreshed fields

A global setting (`autoRefreshedFields`, default `["icon", "color"]`) lists frontmatter keys that always reset to the type's defaults whenever a note is reshelved or retyped. Add `summary` if you want a per-type default summary; add any custom key you want pinned to the type. The Defaults section of each type editor shows an input per key in this list.

## Commands

| Command | Description |
|---|---|
| `Schema: New <type>` | One per type with a folder set. Prompts → filename → folder → open. |
| `Schema: Edit field` | Pick a field on the active note (fuzzy), open type-aware editor. |
| `Schema: Reshelve and clean active file` | Manual reshelve+clean for one file. |
| `Schema: Refresh frontmatter lookups (vault-wide)` | Re-run all frontmatter-mode lookups across the vault. |
| `Schema: Show loaded types` | Console summary. |

## Settings

| Setting | Default | Description |
|---|---|---|
| Auto-reshelve on type change | on | When set, editing a note's `type:` value triggers reshelve+clean automatically. |
| Auto-refreshed frontmatter fields | `["icon", "color"]` | Comma-separated list of keys that get reset to schema defaults on every type change. |

The Settings tab also shows every loaded type with editable folder / filename / icon / color / fields / lookups, plus any validation issues.

## Lookup query runtime

If [Dataview](https://github.com/blacksmithgu/obsidian-dataview) is installed, queries execute via its JS API.

If not, a built-in fallback handles a restricted-but-real-world-useful subset:
- `dv.pages('"FOLDER"').filter(callback)` — entry shape
- Inside callback: frontmatter access, `current.file.path`/`current.file.name`, `.some()`, `===`, `&&`, `||`, `.includes`, string slicing
- `dv.luxon.DateTime.fromFormat(...).toFormat(...)` shim for the week-code arithmetic the temporal lookups need

Queries that go outside this subset throw a clear error; no silent failures.

## Dev / build

```bash
git clone https://github.com/rephlex00/Schema
cd Schema
npm install
npm run build      # one-shot build
npm run dev        # esbuild watch
npm test           # vitest
npm run deploy     # build + copy main.js, manifest.json, styles.css to dev vault
```

## License

MIT.
