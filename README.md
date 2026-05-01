# Schema

A typed-note workflow for Obsidian. Define object types in one YAML file per type; get auto-reshelve on `type:` change, native lookups (frontmatter or inline blocks), in-app type management, and creation commands per type.

> **Status: 1.0.0** — full feature set built. Pending: vault-side migration off Metadata Menu / Workflow Objects, community-plugin submission.

## Why

A typical typed-note workflow in Obsidian today threads through four plugins:

| Concern | Plugin |
|---|---|
| What fields does a `person` have? | Metadata Menu (fileClass) |
| Where do `person` files live? | Workflow Objects (`pathMappings`) |
| How does a new `person` get created? | Templater + QuickAdd |
| What happens when you change `type:`? | Two manual commands |

Schema collapses all of that into one source of truth (`Templates/Objects/<name>.md`) and ships the lifecycle as native subsystems.

## Schema format

```yaml
---
type: person
extends: fact
folder: Facts/People
icon: user
color: "#4A90E2"
filename: "{{firstname}} {{lastname}}"
tags: [type/person]
fields:
  - { name: firstname, type: Input, id: yRU3iU, promptOnCreate: "First name" }
  - { name: lastname,  type: Input, id: LuLVcc, promptOnCreate: "Last name" }
  - { name: relationship, type: Select, id: jTWW4m, options: { valuesListNotePath: Templates/Definitions/relationships.md } }
  - { name: organization, type: MultiFile, id: 9Qr5bx, target: organization }
lookups:
  moments_with_me:
    query: dv.pages('"Moments"').filter(m => m.people && m.people.some(p => p.path === current.file.path))
    render: block
    output: list
---
```

**New keys** (Schema-only):
- `folder` — single string folder for instances (replaces MM `filesPaths`)
- `filename` — liquid template for new-note filenames; `{{var|filter}}` substitution; built-in filters: `lower`, `upper`, `slug`, `slice`, `year`
- `tags` — array of type/* tags (replaces MM `tagNames`)
- `fields[*].promptOnCreate` — prompt label for `Schema: New <type>`
- `fields[*].target` — constrains File/MultiFile pickers to instances of named fileClass
- `lookups[*].render` — `frontmatter` (writes to YAML) or `block` (renders inline via code block)
- `lookups[*].output` — `list`, `bullet-list`, or `count`

**MM-compatible keys** load as-is. Existing fileClasses don't need migration.

## Lookup output modes

**Frontmatter mode** (the MM default): result is written into the entity note's YAML.

```yaml
moments_with_me:
  - "[[Moments/2026/20260425-0000|Durham Family Day]]"
  - "[[Moments/2026/20260321-1519|Obsidian Plugin Idea]]"
```

**Block mode**: place a code block in the note body; the plugin renders the result live.

```markdown
## Moments

\`\`\`schema-lookup
moments_with_me
\`\`\`
```

The block re-renders as data changes; no frontmatter writes, no git noise.

## Commands

| Command | Description |
|---|---|
| `Schema: New <type>` | One per instantiable type (any with a `folder:` set). Prompts → renders filename → places in folder → opens. |
| `Schema: Edit field` | Pick a field on the active note (fuzzy), open type-aware editor. |
| `Schema: Reshelve and clean active file` | Manual reshelve+clean for one file. |
| `Schema: Refresh frontmatter lookups (vault-wide)` | Re-run all frontmatter-mode lookups across the vault. |
| `Schema: Migrate lookups to block mode` | Bulk-convert frontmatter-mode lookups to block mode. |
| `Schema: Reload schemas` | Re-scan `Templates/Objects/`. |
| `Schema: Show loaded types` | Console summary. |

## Settings

| Setting | Default | Description |
|---|---|---|
| Schema folder | `Templates/Objects` | Where fileClass definitions live. |
| Auto-reshelve on type change | on | When set, editing a note's `type:` value triggers reshelve+clean automatically. |

The settings tab also shows every loaded type with editable folder / filename / icon / color, plus any validation issues.

## Lookup query runtime

If [Dataview](https://github.com/blacksmithgu/obsidian-dataview) is installed, queries execute via its JS API (full DataArray surface).

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
