# Changelog

## Unreleased

## 0.4.0

### Added

- **Support for tokens with limited permissions.** A Semaphore token inherits the
  role of its user, so a `task_runner` token (typical for CI and AI agents) lists
  and runs everything but cannot create templates. Until now the CLI answered such
  a write with a bare `Error: Semaphore API 403: Forbidden` — the server sends an
  empty body — leaving no clue about what was missing.
  - `smphe whoami`: user, global admin flag, whether it can create projects, role in
    the active project and the explicit list of what it can and cannot do.
  - 403s (and the 401 of project creation) now explain the current role, the missing
    permission and which roles grant it.
  - `client.users.me()` (`GET /user`) and `client.projects.getRole(id)`
    (`GET /project/{id}/role`, `null` on servers without it).
  - Exported helpers `ProjectPermission`, `ROLE_PERMISSIONS`, `describePermissions()`,
    `hasPermission()`, `rolesGranting()` and `requiredPermissionFor()`, mirroring the
    server's bitmask (`db/ProjectUser.go`) and routing table (`api/router.go`).
  - `SemaphoreApiError` carries the `method` and `endpoint` of the failed request.
- README section "Token permissions" with the role/permission table.
- `Template.task_params` (`AnsibleTemplateParams`) is now typed: the API omits it
  when empty, and it holds the `allow_override_*` flags plus the template's own limit.

### Fixed

- **`tasks run --limit` no longer promises a limit the server will drop.** Semaphore
  only applies a task's limit when the template has `allow_override_limit` enabled
  (`services/tasks/local_executor.go`); otherwise it accepts the request, stores the
  value in `params.limit`, answers 201 and runs the playbook on the whole inventory.
  A playbook meant for one host silently hitting every host is not something to find
  out from a PLAY RECAP, so the CLI now checks the template and refuses the run,
  naming the template's own limit if it has one. The template is only fetched when
  `--limit` is passed, and an unreadable template does not block the run.

  The same silence affects `--arguments` (`allow_override_args_in_task`) and
  `--debug` (`allow_debug`), so the check covers the three. `--playbook`,
  `--environment` and `--dry-run` always apply and are never blocked.

  Note for anyone debugging this: the `limit` field of a task is ALWAYS empty in the
  API (`db:"-"`, deprecated since the params refactor). The effective value lives in
  `params.limit`.

- **A partial schedule update no longer pauses the schedule.** The API field is
  `active`; it never sends `enabled`. The client typed `Schedule.enabled` as a
  required boolean, so reading it gave `undefined`, and `schedules update --cron`
  sent no `active` at all — which Go defaults to false. Changing a cron therefore
  turned the schedule off, silently. `list()`/`get()`/`create()` now normalize
  `active` into `enabled` (both fields are present and typed), and the GET+merge
  moved from the CLI handler into `SchedulesResource.update()`, so the library is
  safe on its own: a partial update no longer answers 400 for the missing
  `template_id` either.
- `smphe schedules list` shows an `Enabled` column. A schedule list that does not
  say what is paused cannot answer the only question it is asked.
- Types that claimed fields the API does not send are now optional, so TypeScript
  stops promising values that are `undefined` at run time: `Project.alert` and
  `max_parallel_tasks`, `Template.allow_override_args_in_task` and `type`,
  `Task.debug` and `dry_run`, `ProjectUser.project_id` and `email`. `Task.params`
  and `Schedule.active` are now declared, and `Schedule.repository_id` admits the
  `null` the server returns.
- `smphe whoami` reports a global admin operating on a project it does not belong
  to (the server answers `role: ""`, `permissions: 0`, and lets it through anyway)
  instead of printing an empty role and stopping.
- `npm run test:integration` works again: it passed a directory to `node --test`,
  which tried to load it as a module and failed before running a single test.

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
