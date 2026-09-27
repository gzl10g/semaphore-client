# Changelog

Every release says which Semaphore version it was verified against, because this is a client of an
API that changes: an entry that describes a contract without naming the server it was checked on is
a claim nobody can re-test. "Verified" means run against a real instance, not read from the source.

## 0.6.0

**Verified against Semaphore v2.19.12** (`v2.19.12-012ed06`), on a throwaway Docker instance: every
item below was run there, with check mode proven by the playbook's own `ansible_check_mode` and by a
file it did not write. Two full manual QA passes (library and CLI, ansible/bash/python/custom apps)
ran against it before release.

### Breaking

- **`templates.update()` merges `taskParams` key by key** over the template's `task_params` instead
  of replacing it: `{ limit: ["web"] }` used to erase the template's tags and `allow_*` flags. To clear
  a value, send it as `false` or `[]`.
- **`Task.dry_run` is `boolean`, no longer optional**: every task the client returns carries it. Code
  that builds `Task` literals (mocks, fixtures) has to add it.

### Security

- **An integration authenticated with a key that is not `login_password` was open to anyone.** Every
  auth method (`token`, `hmac`, `github`, `bitbucket`, `basic`) reads its secret from the password of
  a `login_password` key; with a `string`, `ssh` or `none` key that secret is empty and known to
  anyone: with `token` a POST without the header fired the task, with `hmac` a request signed with an
  empty key did, with `basic` empty credentials did (measured on 2.19.12; `github`/`bitbucket` share
  the HMAC code, not measured). `integrations.create()`
  and `update()` now read the key and refuse any other type — `update()` on every call with an auth
  method, so an integration already configured that way cannot be re-saved as it is — and
  `keys.update()` refuses to retype a `login_password` key that an authenticated integration uses.

### Fixed

- **`tasks run --dry-run` ran for real.** `debug` and `dry_run` were sent at the top level of the
  task, where Semaphore >= 2.14 no longer reads them: the server dropped them without an error, ran
  the playbook without `--check` and reported `success`. They now go in `params` (and still at the top
  level, for older servers). `--debug` had the same bug: it never produced `-vvvv`.
- `tasks run --dry-run` is refused on non-ansible templates, which store the flag and run for real,
  and when the template cannot be read. If the task the server created does not carry `dry_run`, the
  CLI stops it and fails instead of letting a real run pass for a check — and says whether it had
  already started.
- `tasks stop --force` on a **queued** task (`waiting`, or `stopping` after a normal stop) let it run:
  Semaphore marks it `stopped` but leaves it in the queue, and the runner executes the whole playbook
  while the task reads `stopped`. The CLI now forces only a `running` task and stops any other one
  normally, which does take it off the queue.
- `tasks run --playbook` and `--diff` are refused on non-ansible templates: they ran their own script
  while the task reported the requested playbook.
- `tasks.list({ status })` / `tasks list --status` filter client-side: the server ignores the
  parameter and returned every task.
- `templates update --limit` (or any `--tags`, `--skip-tags`, `--allow-*` flag) replaced the whole
  `task_params`, erasing the template's other tags and `allow_*` flags (see *Breaking*).
- `tasks stop` on a task that had already finished rewrote it to `stopped`, erasing the proof that it
  ran. It now reads the task first and, if it is final, answers `already finished (<status>): nothing
  to stop` with exit 0 and `alreadyFinished` in `--json`, without calling the server.
- `Environment.password` (and its create/update inputs) was documented as the ansible-vault key. Semaphore
  stores it and never reads it; the vault password goes in the template's `vaults` (`--vault-key-id`).
- The human output of `get` commands printed nested objects as `[object Object]`; they are JSON now.
  Lists of plain values keep their old format.
- `waitForCompletion()` reads the task once more before declaring a timeout: a task that ended during
  the last interval was reported as still running.
- `tasks run --environment` has to be a JSON **object** of extra variables and is checked before the
  task is created: anything else made Semaphore create the task in `error` and answer 500. Its help
  said "environment variables"; they are extra variables (ansible `--extra-vars`, terraform `-var`)
  merged over the variable group's.
- `keys create/update --type ssh` dropped `--login` (the SSH user) and had no `--passphrase`: both now
  travel in the SSH secret (`--passphrase` on update needs the private key, which is rewritten whole).
  Flags of another key type are refused, not dropped — on `update` against the key's stored type:
  `keys update <ssh key> --string x` used to answer "updated" and wipe the stored secret.
- `environment list` printed the variable group's `password` in clear text in a column, and
  `environment get` too: the GET returns it unmasked. The column is gone, the human `get` skips it
  and `--json` masks it as `********`.
- `inventory create --type file --inventory-file` uploaded the file's content where Semaphore expects the
  path of the inventory inside the repository. It is refused now; `--inventory <path>` is the way.
- `repositories playbooks` said it lists "playbooks/scripts": Semaphore only lists `.yml`/`.yaml`.
- `workflows update` (and `workflows.update()`) erased the workflow's `start_version` and the
  `task_params` of every node when it re-sent the graph: a rename wiped them (measured on 2.19.12).
  Both are kept now.
- `tasks.get()` returns `null` for a task that does not exist on Semaphore 2.19, which answers it with
  a 400 and no body instead of a 404. It threw. Since that 400 also covers a database error, a task
  `waitForCompletion()` already saw that stops being readable throws with status 0 ("may still be
  running"), not a 404.
- `schedules update --run-at` on a cron schedule (and `--cron` on a one-shot one) answered "updated"
  and changed nothing: Semaphore decides by `type` and drops the other field. `schedules.update()`
  now sets `type` from the field it gets when no `type` is given, and `schedules update` refuses
  `--cron` with `--run-at`.
- Numeric positional arguments (`tasks get 12abc`, `templates update abc`) and `--max-parallel-tasks`
  are validated: `parseInt` truncated `12abc` to 12 — acting on another object — and turned `abc`
  into `NaN`, which reached the server as `null`, i.e. unlimited parallel tasks. `SMPHE_PROJECT` is
  validated the same way. A negative `--max-parallel-tasks` is refused (the server reads it as unlimited).

### Changed

- `tasks run` reads the template on every run (one extra GET), not only when an override needs
  checking: it is how a deploy template is recognised. An unreadable template still does not block a
  run without overrides.
- `tasks run` on a deploy template with no successful build is refused instead of deploying nothing.
- **A flag that changes what runs now fails closed when the template cannot be read**: `--limit`,
  `--tags`, `--skip-tags`, `--inventory-id`, `--git-branch`, `--arguments`, `--playbook` and
  `--build-task-id`, like `--dry-run`, `--plan` and `--destroy`. Without the template the CLI cannot
  check its `allow_*` flags or its app, and a dropped `--limit` runs the playbook on the whole
  inventory. Before, all but `--inventory-id` and `--skip-tags` went through. What still passes does
  no harm if dropped: `--debug`/`--debug-level`, `--diff`, `--message`, `--upgrade`/`--reconfigure`,
  and `--auto-approve` (dropped, a terraform task waits for approval).

### Added

- `Task.dry_run` is filled on every task the client returns, from `params.dry_run` (`false` if absent).
- Ansible templates get top-level `limit`, `tags` and `skip_tags` (`[]` when unset), copied from
  `task_params`, in `templates.get/list/create`.
- `templates create/update --description`. `update` writes it through
  `PUT /templates/{id}/description`, which touches nothing else.
- `templates update --json` answers `{ok, message, id, template}`: the template as stored.
- `tasks run --wait [--timeout <s>] [--progress]` and `tasks wait <id>`: exit `0` success, `2` error,
  `3` stopped, `4` rejected, `124` timeout. stdout carries the last task seen, also on `4` and `124`.
- `tasks run --diff` / `RunTaskInput.diff` (ansible `--diff`).
- `WaitForCompletionOptions.onPoll`, and `code` `TIMEOUT` / `REJECTED` / `WAITING_CONFIRMATION` /
  `ABORTED` on the errors `waitForCompletion()` throws. `isTimeout` is still HTTP 408 only.
- `templates create/update --vault-key-id <[name=]id>` (repeatable): the template's vaults, where the
  ansible vault password really comes from. The key must be `login_password`. `templates update
  --no-limit`, `--no-tags`, `--no-skip-tags` clear one key of `task_params`.
- `environment create/update --password` is deprecated and warns on stderr: Semaphore stores it and
  never reads it (measured: a vault-encrypted playbook with only that password fails "no vault
  secrets found"; with `--vault-key-id` it decrypts).
- Every `update` command answers `{ok, message, id, <resource>}` with `--json` (`schedule`,
  `inventory`, `environment`, `repository`, `key`, `integration`, `view`, `project`, `workflow`): the
  object read back after the write, as `templates update --json` already did. Human output unchanged.
- `inventory create/update --repository-id` and `--runner-tag` (`CreateInventoryInput` /
  `UpdateInventoryInput.repositoryId`, `runnerTag`), and `inventory update --inventory-file` and
  `--no-repository-id` (`repositoryId: null`). Changing an inventory to a type other than `file` now
  unlinks its repository, which otherwise came back when it was turned into `file` again.
- `backup restore --name`: restores a copy next to the original, which Semaphore refused with
  "project with name 'X' already exists".
- `WorkflowNodeInput.taskParams`, `CreateWorkflowInput/UpdateWorkflowInput.startVersion`, and
  `workflows create/update --file` accept the snake_case output of `workflows get --json`.
- `tasks.last({ limit, before })` and `tasks list --count <1-200> [--before <taskId>]`: real pagination.
  `tasks.list({ limit, start })` is sent as before, but Semaphore ignores both (measured).
- `CreateScheduleInput.taskParams` / `UpdateScheduleInput.taskParams` (merged key by key, `params`
  too), and `schedules create/update` and `integrations create/update --limit`, `--tags`,
  `--skip-tags`, stored in the `task_params.params` of the task they launch. The CLI refuses them
  when the template would ignore them, and `integrations update` merges them over the stored ones
  (`integrations.update()` itself still replaces `task_params` whole).
- `tasks run --tags`, `--skip-tags`, `--inventory-id`, `--git-branch`, `--debug-level <1-6>` (implies
  `--debug`) and `--message`, and the same fields on `RunTaskInput` (`tags`, `skipTags`, `inventoryId`,
  `gitBranch`, `debugLevel`, `message`). Each one that needs a template setting is refused when the
  template does not have it, like `--limit`: Semaphore stores it, answers 201 and runs without it.
  `--inventory-id` must also be an inventory of the project: one from another project is silently
  replaced by the template's inventory.
- Terraform/OpenTofu: `tasks run --plan`, `--destroy`, `--auto-approve`, `--upgrade`, `--reconfigure`
  (`RunTaskInput.plan/destroy/autoApprove/upgrade/reconfigure`, sent in `params`), refused on other
  apps. `--destroy` is refused unless the template has `allow_destroy`: **Semaphore does not check
  it** and destroys anyway. `--auto-approve` needs `allow_auto_approve` (or `auto_approve`).
  `--plan`/`--destroy` also refuse to run when the template cannot be read (see *Changed*).
  The ansible overrides are refused on any other app even if the
  template kept an `allow_*` from when it was ansible.
- `templates create/update --[no-]allow-destroy`, `--[no-]allow-auto-approve`, `--[no-]auto-approve`,
  `--[no-]override-backend` (terraform/tofu/terragrunt templates only).
- `tasks run --build-task-id` / `RunTaskInput.buildTaskId`. On a **deploy** template without it the CLI
  deploys the latest successful build of its build template, as the UI does, and says which on
  stderr; with no successful build it refuses. Before, a deploy ran with no version and no error.
  An explicit `--build-task-id` must be a successful task of that build template: any other task
  deploys with no version too.

## 0.5.0

**Verified against Semaphore v2.19.12** (`v2.19.12-012ed06`), on a real instance. The contracts below
were first established against **v2.19.8** (`v2.19.8-3449a04`) and re-checked after the upgrade: the
diff between the two tags touches CI, a test helper, two Terraform log lines and the runner's own
config — no routes, no models, no validations.
- `package.json` now has a `description`, more `keywords`, `homepage` and `bugs` (GitHub issues), so the
  package can be found and reported against. The GitHub repository has a Sponsor button
  (`.github/FUNDING.yml`, Buy Me a Coffee).

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

_Verified against: not recorded at the time. The instance it was used against ran 2.19.x._

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
