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
- **Backlinks**: per-property auto-generated reverse links (set a *Backlinks name* on any File/MultiFile property and the target object type gets a frontmatter list of every note that links to it)
- **Custom lookups**: hand-written Dataview queries when a Backlink can't express what you need

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

## Computed lists: Backlinks and Custom lookups

Schema gives you two ways to produce a computed list on a note:

### Backlinks (the common case)

A **backlink** is auto-created when you set a *Backlinks name* on a global
property of type `File` or `MultiFile`. Example: `person.organization` is a
`MultiFile` targeting `organization`. Set its Backlinks name to `members`,
and every `organization` note gets a `members:` list of every `person` that
links to it.

You do not write a query. The list updates whenever a person's
`organization:` value changes. Each object type's editor shows a card per
Backlink with a sample of the matching notes and a button to jump back to
the property that defines it.

By default the result is written into the target note's YAML frontmatter:

```yaml
members:
  - "[[People/Alice]]"
  - "[[People/Bob Smith]]"
```

Each Backlinks card has an *Show in frontmatter (default)* / *Show as
inline block* toggle that flips the destination per-backlink without
losing the auto-update behavior.

### Custom lookups (advanced)

For lists that can't be expressed as a backlink (date-windowed queries,
multi-criteria filters, etc.), you can hand-write a Dataview query in the
*Custom lookups* section of any object type. Each row chooses where the
result lands:

- **Property**: written into the note's YAML, same shape as Backlinks.
- **In the note body**: rendered live via a ```schema-lookup <name>```
  code block you place in the note body:

````markdown
## Recent moments

```schema-lookup
recent_moments
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
- `dv.pages('"FOLDER"').filter(callback)` - entry shape
- Inside callback: frontmatter access, `current.file.path`/`current.file.name`, `.some()`, `===`, `&&`, `||`, `.includes`, string slicing
- `dv.luxon.DateTime.fromFormat(...).toFormat(...)` shim for the week-code arithmetic the temporal lookups need

Queries that go outside this subset throw a clear error; no silent failures.

## Cookbook

### Lightweight CRM

Two types - `person` and `interaction` - give you a contact list with a running
log of every touchpoint, and each person's note automatically lists their
interactions in reverse-chronological order.

```text
person:
  folder:     People
  filename:   {{firstname}} {{lastname}}
  fields:
    firstname (Input, promptOnCreate)
    lastname  (Input, promptOnCreate)
    company   (Input)
    email     (Input)

interaction:
  folder:     Interactions/{{date:YYYY}}
  filename:   {{date:YYYYMMDD-HHmm}} {{summary|slug}}
  fields:
    summary    (Input, promptOnCreate)
    when       (DateTime)
    with       (MultiFile, target: person, Backlinks name: interactions)
    channel    (Select: email, call, in-person, slack)
```

The *Backlinks name* `interactions` on `interaction.with` gives every
`person` note an `interactions:` list of the interactions that mention them.
No manual maintenance.

### Daily journal with people + moments

Daily notes capture quick reflections; moments are richer per-event records that
link to people. Backlinks mean each person's note shows every moment they
appear in.

```text
moment:
  folder:    Moments/{{date:YYYY}}
  filename:  {{date:YYYYMMDD-HHmm}}
  fields:
    summary (Input, promptOnCreate: "What happened?")
    people  (MultiFile, target: person, Backlinks name: moments_with_me)
    place   (File, target: place)

daily:
  folder:    Daily/{{date:YYYY}}/{{date:MM}}
  filename:  {{date:YYYY-MM-DD}}
  fields:
    weather  (Input)
    mood     (Cycle: bad, ok, good, great)
```

Run `Schema: New moment` and the plugin prompts for the summary, then opens the
note in `Moments/2026/20260602-1543.md`. Add `[[Jane Doe]]` to the `people`
field - Jane's note's `moments_with_me` list updates automatically on the next
metadata refresh.

### Zettelkasten

Two types - `permanent` for evergreen notes and `literature` for source-tied
notes - with a `references` field that wires both back to source material.

```text
permanent:
  folder:    Zettel
  filename:  {{date:YYYYMMDD-HHmm}} {{title|slug}}
  fields:
    title       (Input, promptOnCreate)
    references  (MultiFile, target: literature, Backlinks name: cited_by)

literature:
  folder:    Literature
  filename:  {{author}} - {{title}}
  fields:
    title  (Input, promptOnCreate)
    author (Input, promptOnCreate)
    year   (Number)
    url    (Input)
```

Each literature note's `cited_by` list updates automatically when a permanent
note references it.

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

`npm run deploy` copies the build into a local vault for testing. Set
`OBSIDIAN_PLUGIN_DIR` to your vault's plugin folder first, e.g.:

```bash
export OBSIDIAN_PLUGIN_DIR="/path/to/YourVault/.obsidian/plugins/schema"
npm run deploy
```

## License

MIT.
