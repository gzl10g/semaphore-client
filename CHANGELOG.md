# Changelog

## Unreleased

## 0.3.0

### Added

- `workflows` resource and CLI command (Semaphore >= 2.19): `list`, `get`, `create`,
  `update`, `delete`, `run`, `runs`, `stop`, `approvals`, `approve`, `reject`.
  Workflows chain several templates as one unit with optional approval gates, so a
  deploy chain no longer has to be orchestrated by hand. Graphs are created from a
  JSON file (`--file`).
- `backup` resource and CLI command: `export` (stdout or file with mode 600) and
  `restore` (always creates a new project). Semaphore has no config-as-code
  (upstream #3109), so this is the closest thing to versioning a project.

### Fixed

- `inventory create` no longer requires `--ssh-key-id`. The API happily creates a
  static inventory without a key (201, `ssh_key_id: null`); the CLI was imposing a
  restriction the server does not have.
- `Inventory.ssh_key_id` is typed `number | null`: the API returns null, not 0.
- The published package no longer ships the compiled tests. `npm test` wrote its
  output inside `dist/`, which `files: ["dist"]` then published: 179 files / 396 kB,
  110 of them `dist/src` and `dist/tests`. Tests now build to `dist-test/` and
  `build` cleans first — 69 files / 157 kB.
- `runHandler` now waits for stdout to flush before `process.exit()`. Exiting
  straight after `console.log()` can truncate piped output at the pipe buffer
  size, so `--json | jq` could get cut JSON while redirecting to a file worked.
- `npm run lint` is clean again (7 pre-existing errors: a dead `require`, unused
  catch bindings, errors thrown without `cause`, and an inline `import()` type).

## 0.2.6

### Fixed

- `schedules update` CLI command no longer resets `template_id` (and other fields) to `0` when not explicitly passed. The handler now fetches the existing schedule and merges the provided fields before sending the PUT request.

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
