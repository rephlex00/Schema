# Schema

Typed-note workflow for Obsidian. Define object types in YAML; get auto-reshelve on type change, native lookups, and a single source of truth for schema, folder, filename, and creation prompts.

> **Status: pre-alpha (0.1.0).** Phase 0 (bootstrap) only. The plugin currently registers a single `Schema: Hello` command for build-pipeline validation. See the multi-phase plan in the project's design doc for the roadmap.

## Why

Obsidian's typed-note workflows today require gluing together Metadata Menu (for fileClass schemas), Workflow Objects (for type-based folder routing), Templater (for Folder Templates and prompts), and QuickAdd (for type-specific creation commands). One logical concept — "what is a `person`?" — is described across four config files. Editing the schema means editing four places.

`schema` collapses that into one source-of-truth file per type and ships the lifecycle behaviors (creation, type change → folder move + frontmatter update, lookup queries) as native subsystems.

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
  - { name: firstname, type: Input, promptOnCreate: "First name" }
  - { name: lastname,  type: Input, promptOnCreate: "Last name" }
  - { name: relationship, type: Select, valuesFrom: Templates/Definitions/relationships.md }
  - { name: organization, type: MultiFile, target: organization }
lookups:
  moments_with_me:
    query: dv.pages('"Moments"').filter(m => m.people && m.people.some(p => p.path === current.file.path))
    render: block
    output: list
---
```

Existing Metadata Menu fileClasses load unchanged — the new keys (`folder`, `filename`, `tags`, `promptOnCreate`, `target`, `lookups[*].render`, `lookups[*].output`) are additive.

## Development

```bash
git clone https://github.com/rephlex00/obsidian-schema
cd obsidian-schema
npm install
npm run dev          # esbuild watch mode
```

Sideload into a test vault by symlinking or copying `main.js`, `manifest.json`, and `styles.css` to `<vault>/.obsidian/plugins/schema/`. The `npm run deploy` script does this for the dev vault.

## License

MIT.
