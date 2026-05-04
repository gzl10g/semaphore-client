# Changelog

## Unreleased

## 0.2.5

### Fixed

- `repository.url` in `package.json` now points to the public GitHub mirror.

## 0.2.4

### Changed

- CI: add `mirror:github` job to sync releases to GitHub on each tag.

## 0.2.3

### Added

- `smphe keys create` now accepts `--private-key` / `--private-key-file` (SSH), `--login` and `--password` (login type). CLI validates required fields per type before sending to the API.
- `smphe environment create` now accepts `--var KEY=VALUE` (repeatable), `--from-env <path>` (load from `.env` file), and `--secret` (send variables encrypted to the `json` field instead of `env`). Variables from `--from-env` and `--var` are merged; `--var` takes precedence.
- `smphe inventory create` now accepts `--inventory-file <path>` as an alternative to inline `--inventory`.
- Built-in `.env` parser for `--from-env`: handles `export KEY=VALUE`, CRLF line endings, quoted values, and empty values.
- `tests/fixtures/` with synthetic test fixtures for CLI integration tests.
- `smphe keys update <id>` command: rotate SSH private key (`--private-key` / `--private-key-file`), update login credentials (`--login` / `--password`), rename (`--name`), or change type (`--type`). Same validation rules as `keys create`.

## 0.2.2

### Fixed

- CI: skip `prepublishOnly` in publish job (`dist/` already built by build job)

## 0.2.1

### Added

- `llms.txt` at project root: full command reference for AI agents
- `smphe tasks list --status <status>`: server-side filtering in CLI (was missing despite library support)
- `smphe schedules update --enabled / --no-enabled`: pause/resume schedule from CLI

### Changed

- `smphe --help` now includes setup steps, quick-start examples, and project context priority

## 0.2.0

### Breaking

- `projects.update()` now returns `void` (aligned with all other resources)

### Added

- `tasks.waitForCompletion()` polling helper with `pollInterval`, `timeout`, and `signal`
- `tasks.list()` accepts `status` filter for server-side filtering
- `schedules.create/update()` support `enabled` flag to pause/resume without deleting
- `views` resource: full CRUD for grouping templates in the Semaphore UI
- `projects.users` sub-resource: `list`, `add`, `update`, `remove` project members
- `client.info()` returns Semaphore server info (`SemaphoreInfo`)

### Fixed

- `tasks.get()` now returns `null` instead of throwing on Semaphore ≤2.9 quirk (400 instead of 404)

### Docs

- JSDoc on `Environment.password`: clarifies it is an ansible-vault encryption key, not an auth password
- JSDoc on `RunTaskInput.environment` and `Task.environment`: clarifies the field is a serialized JSON string

## 0.1.0

- feat: initial release
- Resources: projects, keys, repositories, inventory, environment, templates, tasks, schedules, users
