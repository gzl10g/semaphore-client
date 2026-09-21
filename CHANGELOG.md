# Changelog

Every release says which Semaphore version it was verified against, because this is a client of an
API that changes: an entry that describes a contract without naming the server it was checked on is
a claim nobody can re-test. "Verified" means run against a real instance, not read from the source.

## Unreleased

_Verified against: —_

## 0.5.0

**Verified against Semaphore v2.19.12** (`v2.19.12-012ed06`), on a real instance. The contracts below
were first established against **v2.19.8** (`v2.19.8-3449a04`) and re-checked after the upgrade: the
diff between the two tags touches CI, a test helper, two Terraform log lines and the runner's own
config — no routes, no models, no validations.

### Breaking

- **`update()` now reads before it writes.** Every `update()` issues a `GET` first (see *Fixed*),
  which has three consequences for callers: it needs read access to the object, a missing object is
  reported by that read, and two concurrent updates to the same object are last-writer-wins over the
  whole object, not just over the fields each caller named. Semaphore's API has no ETag or version to
  do better.
- `KeyType` no longer has `login`: the server's types are `ssh`, `login_password`, `string` and
  `none` (`db/AccessKey.go`). The CLI still accepts `--type login` and normalizes it.
- `Template.vault_key_id` and `Template.build_version_template` are gone, and so are
  `vaultKeyId` / `buildVersionTemplate` in `CreateTemplateInput` / `UpdateTemplateInput`.
  Neither field exists in Semaphore 2.19: vaults are a list (`vaults`) and the build
  dependency is `build_template_id` (`buildTemplateId`). The client was sending fields
  the server dropped on the floor.

### Fixed

- **`tasks.stop()` did not stop anything.** It sent `DELETE /project/{id}/tasks/{id}`, which deletes
  the task record — and the handler refuses to delete a task that is queued or running, so 2.19.8
  answered 400 and the task ran to completion. Stopping is
  `POST /tasks/{id}/stop` **with a body**: the handler runs `helpers.Bind`, which decodes the request
  body, and an empty one is an `io.EOF` that answers 400 before the task pool is even reached. So the
  call now sends `{ force }`, which also exposes the forced stop the API offers. Same for
  `templates.stopAllTasks()`. Verified against a real 2.19.8: the task ends `stopped`.
  The task record can still be deleted with the new `tasks.delete()`.

- **Not every 2xx carries JSON, and the client assumed it did.** `tasks.rawOutput()` is
  `text/plain` (it is the log), and several handlers answer `200` with no body at all — validating a
  cron, for one. Both threw `SemaphoreApiError … body is not valid JSON` where nothing had failed.
  The transport now reads the body as text: an empty one resolves to `undefined`, and
  `responseType: "text"` returns it raw.

- **A schedule was created paused.** `CreateScheduleInput.enabled` claimed the API defaults to active;
  it does not — Go's zero value is `false`, so a schedule created without `active` never fired. It is
  now created active unless `enabled: false` (`--no-enabled`).

- **A partial update no longer erases the rest of the object.** Semaphore's PUT handlers
  bind the whole struct and persist it (`api/projects/templates.go`), so every field left
  out of the body is written back as its zero value. Reproduced against a real 2.19.8:
  renaming a template (passing the fields its validation demands) erased its `survey_vars`,
  `task_params` and `git_branch`, and collapsed `environment_ids` from two groups to one;
  renaming a variable group emptied its variables; changing a repository's branch blanked
  its URL and SSH key; renaming a view moved it to position 0. A template update that left
  those required fields out did not even get that far: it answered `400 Invalid app id` or
  `400 template inventory can not be empty`. Every `update()` now reads the object and sends it back whole
  (`src/resources/merge.ts`), keeping even the fields this client does not type, and
  dropping the derived ones the PUT must not receive (`last_task`, `tasks`, `permissions`,
  `tpl_*`, `user_name`). Cost: one extra GET per update.

  The same helper fixes `schedules.update()`, which merged field by field and still reset
  `name`, `type`, `delete_after_run` and `task_params`.

- **`templates.update({ environmentId })` was a no-op.** `environment_ids` is the source of
  truth (table `project__template_environment`); the server only falls back to the legacy
  `environment_id` when the list is absent (`Template.ApplyLegacyEnvironmentField`), and
  the merged body always carries the list. The client now rewrites `environment_ids`, and
  `environmentIds` is accepted for several variable groups at once.

- **Keys never received their secret.** `AccessKey.Secret` is `json:"-"` in the server, so the
  `{ secret: { private_key } }` body this client sent was dropped by `encoding/json` and the key was
  stored empty — `keys.create()` produced credentials with no material, and `keys.update()` was a
  no-op that answered 204. The material now travels in the container the type dictates (`ssh`,
  `login_password`, `string`), and an update that rewrites it sends `override_secret: true`, without
  which `db/sql/access_key.go` only updates the name. Verified against a real 2.19.8: a key created
  by 0.4.0 comes back from `GET /project/:id/keys` with `empty: true` (no material) and rotating it
  answered `400`; created and rotated by this version, it does not. Changing `type` now requires passing the secret
  too, because the server rewrites the type only together with the material, and the old material
  cannot be read back.

  `keys.update()` also stopped wiping the key's type, and still never sends an empty secret: the GET
  does not return secret material, so those containers are dropped from the merge.

- **`users.update()` had the same full-replace bug** (`api/users.go` binds the whole struct):
  renaming a user blanked their email and dropped their admin flag. It merges now, like the rest.

- **Renaming a variable group silently disabled its secret sync.** `UpdateEnvironment` saves
  `sync_enabled` / `sync_interval` / `sync_paths` straight from the body, and the old partial update
  sent none of them.

- **A 2xx whose body is not JSON no longer escapes as a raw `SyntaxError`**: it becomes a
  `SemaphoreApiError` like every other transport failure, so callers can classify it and the CLI can
  explain it. And an update whose read comes back empty says so, instead of claiming the object does
  not exist.

- **A 403 during an update is reported as the write it was about to be.** Semaphore lets any project
  member read, so a denied `GET` carries no permission to explain: reported as a read, the CLI's
  permission hint had nothing to say and printed a bare `403`.

- `smphe projects update` printed `undefined` (and, with `--json`, a bare `undefined` that is not
  valid JSON) because it formatted the `void` that `update()` returns.

- **`waitForCompletion()` could poll forever.** Only `success`, `error` and `stopped` are
  final (`IsFinished()` in `pkg/task_logger`), but a task can sit in `waiting_confirmation`
  (a workflow approval gate) or stay `rejected` for good. A `rejected` task now throws, and
  `waiting_confirmation` takes an explicit decision via
  `onWaitingConfirmation: "wait" | "throw"` (default `wait`, the previous behaviour).

- `TaskStatus` declared 5 of the 10 statuses the server reports. The missing ones
  (`starting`, `waiting_confirmation`, `confirmed`, `rejected`, `stopping`) are now typed
  and accepted by `smphe tasks list --status`.

### Added

- **`integrations`**: the whole sub-API Semaphore uses for incoming webhooks — integrations, matchers,
  extract values, and aliases at both levels (an integration's own, and the project's, which are
  different routes). Verified end to end against a real server: the webhook fired the task with the
  value extracted from its body.

  Two things the server does not tell you, and this client now does:
  - **`searchable` decides which alias works, and only one works.** With `searchable: false` only its
    own alias fires and its matchers are **never evaluated**; with `true` its own alias stops
    answering and it is reached through the project's alias, which picks it by matcher. The CLI warns
    about both dead combinations, because the webhook answers **204 whether it launched a task, failed
    authentication, or matched nothing** — the only proof something ran is the `X-Semaphore-Task-ID`
    header.
  - `GET /integrations/{id}/refs` is a server stub: it answers `{"matchers":null,"values":null}` even
    with matchers and values present, so it is exposed in the library but has no CLI command — it
    could only print two empty lists.

- **Admin surface** (needs a global admin, not a project role): `apps` CRUD and activation, global
  `roles`, and the instance task pool. `explainDenied` now says so when one of them answers 403 —
  before, a project role hint was useless there.

- **Config moves to XDG**: new installs use `$XDG_CONFIG_HOME/smphe/config.json` (`~/.config/smphe/`),
  as [clig.dev](https://clig.dev/) recommends, instead of a dotfile in `$HOME`. An existing
  `~/.smphe-client/config.json` is still read **and still written to**: silently relocating a file
  that holds someone's token is not a surprise a release should bring.

- **`SMPHE_TOKEN_FILE`**, which wins over `SMPHE_TOKEN`. A secret in the environment is inherited by
  every child process, shows up in `docker inspect` and in systemd's unit state, and lands in crash
  dumps; clig.dev says outright not to put secrets there. `SMPHE_TOKEN` stays because CI expects it,
  but the file form is the one to use.

- **`smphe login --token-stdin`**: reads the token from stdin, so it stays out of the shell history
  and out of `ps`, where `--token <value>` leaves it. `--token` still works and now warns. The config
  directory is created (and tightened, if an older version left it open) with `700`; the file was
  already `600`.

- **`SMPHE_HOST` and `SMPHE_TOKEN` are read from the environment**, with precedence over
  `~/.smphe-client/config.json` — the same way `SMPHE_PROJECT` already worked. Without them, pointing
  the CLI at another server meant editing a file in `$HOME`, and anything that assumed the usual env
  vars work — a script, a CI job, an agent verifying a change — kept talking to whatever instance the
  config held. That is not hypothetical: it is how a review of this very release ended up writing to
  a production project. `smphe config show` now says where each value comes from (`(from SMPHE_HOST)`)
  and warns when the environment is overriding the file, because the danger is not the precedence —
  it is a forgotten `export` redirecting commands in silence.

- **Endpoints of the existing resources that the client simply did not have.** They came out of a
  route-by-route diff of `api/router.go@v2.19.8` against the client, which is how this should have
  been scoped from the start:
  - `projects`: `testNotifications()` (the "Test Alerts" button), `clearCache()`, `events()`,
    `lastEvents()`, `leave()`.
  - `repositories`: `branches()` and `playbooks({ branch })` — what the UI offers in its dropdowns,
    so a template no longer has to be pointed at a path typed blind — plus `refs()`.
  - `tasks`: `stages()`, `ansibleHosts()` (the PLAY RECAP without parsing the log),
    `ansibleErrors()`, `rawOutput()`, `last()`, and `confirm()` / `reject()` for approval gates.
  - `templates`: `refs()`, `schedules()`, `tasks()`, `lastTasks()`, `stopAllTasks()`,
    `setDescription()`, and `attachInventory()` / `detachInventory()` / `setDefaultInventory()`.
  - `views`: `setPositions()` and `templates()`.
  - `environment`: `refs()` and `sync()`; `keys` and `inventory`: `refs()`.
  - `schedules`: `setActive()` (pause/resume without rewriting the schedule) and `validate()`.
  - CLI: `views` (full CRUD, which only existed in the library), `apps list`, `tasks confirm|reject|
    stages|hosts`, `repositories branches|playbooks`, `templates refs|stop-all-tasks`,
    `projects test-alerts|clear-cache`.

- **Secrets in variable groups.** A group has four quadrants — plain extra variables (`json`), plain
  environment variables (`env`), secret extra variables and secret environment variables — and the
  client only spoke the plain two. `CreateEnvironmentInput` / `UpdateEnvironmentInput` now take
  `secrets: [{ type: 'var' | 'env', name, secret, id?, operation? }]`, with the operation defaulting
  to `create` (or `update` when the entry names an existing secret by id). From the CLI:
  `--secret-var KEY=VALUE`, `--secret-env KEY=VALUE`, `--extra-var KEY=VALUE` and
  `--delete-secret <name>` on `environment create` / `environment update`.
- **Several variable groups per template from the CLI**: `smphe templates create|update
  --environment-ids 3,7`, plus `--git-branch`. The library already took `environmentIds`.
- `smphe keys create|update --type string --string <value>`: the `string` key type had no way in.
- `smphe schedules create|update --name`, and `CreateScheduleInput.name` / `UpdateScheduleInput.name`.
- `smphe inventory --type` help now lists the workspace types 2.19 added
  (`terraform-workspace`, `tofu-workspace`, `terragrunt-workspace`).

### Deprecated

- `smphe environment create --secret` does not encrypt anything: it puts `--var`/`--from-env` in the
  extra variables field. Use `--secret-var` / `--secret-env` for real secrets. The flag still works
  and its help now says what it actually does.

### Types aligned with 2.19.8

- Types aligned with 2.19.8: `Template.environment_ids`, `vaults`, `survey_vars`,
  `autorun`, `git_branch`, `runner_tag`, `allow_override_branch_in_task`,
  `allow_parallel_tasks`, `suppress_success_alerts`, `jwt_params`, `build_template_id`;
  `Task.schedule_id`, `integration_id`, `inventory_id`, `git_branch`, `workflow_run_id`,
  `workflow_node_id`, `artifacts`, `user_id`; `Schedule.name`, `type`, `delete_after_run`,
  `run_at`, `task_params`; `Environment` secret-storage and sync fields; `Project.type`
  and `default_secret_storage_id`; `Inventory.template_id`, `repository_id`, `runner_tag`
  and the `terraform-workspace` / `tofu-workspace` / `terragrunt-workspace` types.

## 0.4.0

_Verified against: not recorded at the time. The homelab instance ran 2.19.x._

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

_Verified against: not recorded at the time. Workflows require Semaphore >= 2.19._

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
