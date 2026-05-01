# Changelog

All notable changes to the Schema plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `SchemaLoader` subsystem: scans `Templates/Objects/`, parses extended fileClass YAML, validates, watches for file changes, emits `schema-loaded` and `schema-changed` events.
- `Schema: Reload schemas` command — force re-scan.
- `Schema: Show loaded types` command — print loaded schema summary to console + notice.
- Settings: `schemaFolder` (default `Templates/Objects`), `autoReshelveOnTypeChange` (placeholder for Phase 3).

## [0.1.0] — 2026-04-30

### Added
- Initial repo scaffold: manifest, esbuild build pipeline, TypeScript strict-mode config.
- `Schema: Hello` command for build-pipeline validation.
