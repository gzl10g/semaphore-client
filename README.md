# @gzl10/semaphore-client

Typed HTTP client for [Semaphore UI](https://semaphoreui.com/) API. ESM-only, Node ≥20.

The library itself depends on nothing but the runtime — it is `fetch` and types. The published package
carries one dependency, [`commander`](https://www.npmjs.com/package/commander), used by the `smphe`
CLI that ships with it.

Verified against Semaphore **v2.19.12** (and v2.19.8 — nothing in the HTTP API changed between them).

## Install

```bash
npm install @gzl10/semaphore-client
```

## Usage

```ts
import { SemaphoreClient } from '@gzl10/semaphore-client'

const client = new SemaphoreClient({
  baseUrl: 'http://semaphore.example.com',
  apiToken: 'your-api-token',
})

// List projects
const projects = await client.projects.list()

// Run a playbook and wait for completion
const task = await client.tasks.run(projectId, { templateId: 1 })
const result = await client.tasks.waitForCompletion(projectId, task.id)
console.log(result.status) // 'success' | 'error' | 'stopped'

// Get task output
const output = await client.tasks.output(projectId, task.id)

// Check Semaphore version
const { version } = await client.info()
```

## Resources

| Resource | Methods |
|----------|---------|
| `projects` | `list`, `get`, `create`, `update`, `delete` |
| `projects.users` | `list`, `add`, `update`, `remove` |
| `keys` | `list`, `get`, `create`, `update`, `delete` |
| `repositories` | `list`, `get`, `create`, `update`, `delete` |
| `inventory` | `list`, `get`, `create`, `update`, `delete` |
| `environment` | `list`, `get`, `create`, `update`, `delete` |
| `templates` | `list`, `get`, `create`, `update`, `setDescription`, `refs`, `tasks`, `stopAllTasks`, `delete` |
| `views` | `list`, `get`, `create`, `update`, `delete` |
| `tasks` | `list`, `last`, `get`, `run`, `stop`, `confirm`, `reject`, `delete`, `output`, `stages`, `ansibleHosts`, `waitForCompletion` |
| `schedules` | `list`, `get`, `create`, `update`, `delete` |
| `users` | `list`, `get`, `create`, `update`, `delete` |
| `workflows` | `list`, `get`, `create`, `update`, `delete`, `run`, `listRuns`, `getRun`, `stopRun`, `listApprovals`, `resolveApproval` |
| `integrations` | `list`, `get`, `create`, `update`, `delete`, `refs`, plus `matchers`, `values` and `aliases` |
| `apps` | `list`, `listActive`, `get`, `update`, `setActive`, `delete` (admin) |
| `roles` | `list`, `get`, `create`, `update`, `delete` (global roles, admin) |
| `instanceTasks` | `list`, `listQueued`, `listRunning`, `stop` (the live pool, admin) |
| `backup` | `export`, `restore` |

## Key features

### Run a playbook and wait for the result

```ts
const task = await client.tasks.run(projectId, {
  templateId: 42,
  limit: 'webservers',                                // restrict to a host group
  environment: JSON.stringify({ target_env: 'prod' }), // extra vars (JSON string)
  arguments: '["--tags","deploy"]',                    // extra CLI args: a JSON array, as a string
})
// `limit` and `arguments` only take effect if the template allows overriding them:
// see "Task overrides that the server silently drops" below.

const result = await client.tasks.waitForCompletion(projectId, task.id, {
  pollInterval: 3000,  // ms between polls (default: 2000)
  timeout: 600_000,    // ms max wait (default: no limit)
  signal,              // AbortSignal for external cancellation
  onPoll: (t) => console.error(t.status), // called with every task read while polling
})

// If timeout is reached, the task keeps running in Semaphore (the error's `code` is "TIMEOUT").
// Call tasks.stop() to cancel it. Other codes: "REJECTED", "WAITING_CONFIRMATION", "ABORTED".
if (result.status === 'error') {
  const output = await client.tasks.output(projectId, task.id)
  console.error(output.map(l => l.output).join('\n'))
}
```

### Check mode (`dryRun`)

`dryRun: true` runs the playbook with `ansible-playbook --check`. It travels in `params.dry_run`, which
is where Semaphore reads it since 2.14 — a top-level `dry_run` is dropped without an error, and the
task runs for real. Every task this client returns carries `dry_run`, copied from `params`.

**Only ansible templates honour it.** A bash, python or terraform template stores the flag, answers
201 and runs for real. The `smphe` CLI refuses `--dry-run` on those and when it cannot read the
template, and stops the task and fails if the one it created does not carry `dry_run`. The library
does not check the template for you.

```ts
const task = await client.tasks.run(projectId, { templateId: 42, dryRun: true, diff: true })
task.dry_run // true: the server stored it where the executor reads it
```

### Partial updates are safe

Semaphore's `PUT` handlers replace the whole object: any field missing from the body is written back
as its zero value. So every `update()` reads the object first and sends it back whole, changing only
what you passed — one extra `GET` per update, and nothing silently erased.

```ts
// Keeps survey vars, task params, vaults, app… everything you did not name
await client.templates.update(projectId, templateId, { name: 'Deploy v2' })

// task_params merges key by key: this changes the limit and keeps tags and allow_* flags
await client.templates.update(projectId, templateId, { taskParams: { limit: ['web01'] } })
```

### Task statuses

`success`, `error` and `stopped` are the only final statuses. `waitForCompletion()` polls until one
of them, and refuses to wait forever on the two that never get there on their own: a `rejected`
approval throws, and `waiting_confirmation` (a workflow approval gate) can throw too.

```ts
const task = await client.tasks.waitForCompletion(projectId, taskId, {
  onWaitingConfirmation: 'throw', // default: 'wait'
})
```

### Filter tasks by status

The server ignores the `status` parameter and returns every task, so the client filters the list
itself.

```ts
const failed = await client.tasks.list(projectId, { status: 'error' })
const running = await client.tasks.list(projectId, { status: 'running' })
```

`tasks.list()` also sends `limit` and `start`, but Semaphore ignores both. The only real pagination
is `tasks.last()`: newest first, `limit` up to 200 (the default), and `before` a task id — keep
paging with the last id until a page comes back shorter than `limit`.

```ts
const page = await client.tasks.last(projectId, { limit: 50 })
const next = await client.tasks.last(projectId, { limit: 50, before: page.at(-1)!.id })
```

### Pause and resume a schedule

```ts
// Disable without deleting
await client.schedules.update(projectId, scheduleId, { enabled: false })

// Re-enable later
await client.schedules.update(projectId, scheduleId, { enabled: true })
```

### Manage project members

```ts
// List members
const members = await client.projects.users.list(projectId)

// Grant access
await client.projects.users.add(projectId, { userId: 5, role: 'task_runner' })

// Change role
await client.projects.users.update(projectId, userId, { role: 'manager' })

// Revoke access
await client.projects.users.remove(projectId, userId)
```

### Organize templates with views

```ts
// Create a view (grouping for the Semaphore UI)
const view = await client.views.create({ projectId, title: 'Provisioning' })

// Assign a template to the view
await client.templates.update(projectId, templateId, { viewId: view.id })
```

### Variable groups: four quadrants

A variable group holds plain and secret variables, each of them either an *extra variable* (what
Ansible gets as `--extra-vars`) or an *environment variable*:

| | Extra variables | Environment variables |
|---|---|---|
| **Plain** | `json` field | `env` field |
| **Secret** | `secrets[]` with `type: 'var'` | `secrets[]` with `type: 'env'` |

```ts
await client.environment.create({
  name: 'deploy', projectId,
  json: JSON.stringify({ target: 'prod' }),   // plain extra vars
  env: JSON.stringify({ LOG_LEVEL: 'info' }), // plain env vars
  secrets: [
    { type: 'var', name: 'api_token', secret: 't0k3n' },
    { type: 'env', name: 'DB_PASSWORD', secret: 'p4ss' },
  ],
})

// Later: rotate one, delete another (deleting needs the secret's id, which list/get return)
await client.environment.update(projectId, envId, {
  secrets: [
    { id: 17, type: 'var', name: 'api_token', secret: 'n3w' },
    { id: 18, type: 'env', name: 'DB_PASSWORD', operation: 'delete' },
  ],
})
```

From the CLI: `--var` / `--extra-var` for the plain ones, `--secret-var` / `--secret-env` for the
secret ones, and `--delete-secret <name>` to remove one.

### Several variable groups per template

Since Semaphore 2.19 a template can use several variable groups. `environment_ids` is the source of
truth — `environment_id` is the legacy single field, and the server ignores it when the list travels.

```ts
await client.templates.update(projectId, templateId, { environmentIds: [3, 7] })
```

```bash
smphe templates create --environment-ids 3,7 …   # or --environment-id 3 for a single one
```

### Ansible vault password

The vault password of a playbook comes from the **template's vaults**, each one pointing at a
`login_password` key whose password is the vault password. A variable group's `password` field is
stored by Semaphore and never read: a vault-encrypted playbook with only that password fails with
"no vault secrets found".

```ts
await client.templates.update(projectId, templateId, {
  vaults: [{ type: 'password', vault_key_id: vaultKeyId }], // a login_password key
})
```

```bash
smphe templates update 42 --vault-key-id 12              # or several: --vault-key-id prod=12 --vault-key-id dev=13
```

### Chain templates with a workflow (Semaphore >= 2.19)

A workflow runs several templates as one unit, with optional approval gates in
between — what you would otherwise do by hand, chaining templates and waiting.

```ts
const wf = await client.workflows.create({
  projectId: 1,
  name: "deploy-with-approval",
  nodes: [
    { id: 1, kind: "task", templateId: 5 },
    { id: 2, kind: "approval", approvalMessage: "Ship it?" },
    { id: 3, kind: "task", templateId: 8 },
  ],
  edges: [
    { sourceNodeId: 1, destinationNodeId: 2, condition: "on_success" },
    { sourceNodeId: 2, destinationNodeId: 3, condition: "on_success" },
  ],
});

const run = await client.workflows.run(1, wf.id);
// run.root_task_id lets you follow the output with tasks.output()

// When the run reaches the gate it waits with status "approval":
const [gate] = await client.workflows.listApprovals(1, wf.id, run.id);
if (gate) await client.workflows.resolveApproval(1, wf.id, run.id, gate.workflow_node_id, true);
```

> Node `id` is a client-side id used only to wire the edges (the server assigns
> the real ones), and it is **required** as soon as the graph has edges. The
> graph must have exactly one root node.

### Back up a whole project

Semaphore has no config-as-code ([#3109](https://github.com/semaphoreui/semaphore/issues/3109)),
so exporting is the only way to keep a project's configuration under version control.

```ts
const backup = await client.backup.export(1);
const restored = await client.backup.restore(backup); // always creates a NEW project
```

Secrets are not exported in plain text: a restored project needs its keys and
secret values set again.

## Using with AI agents and scripts

Any agent or script with shell access can drive Semaphore through the `smphe` CLI with no extra code. Install it globally and point it at the commands — JSON output makes it easy to pipe into further processing, and `--wait` turns how a task ended into the exit code:

```bash
# What is this token allowed to do?
smphe whoami --json

# Discover available playbooks
smphe templates list --json

# Run a playbook and get the task ID
smphe tasks run 42 --limit webservers --json

# …or run it and block until it ends: exit 0 on success, 2 on error (see "Waiting for a task")
smphe tasks run 42 --wait --timeout 1800 --json | jq .status

# Read the output of a task
smphe tasks output <taskId> --json

# Manage schedules
smphe schedules list --json
smphe schedules update <id> --no-enabled
```

## Configuration and secrets

Precedence follows [clig.dev](https://clig.dev/): **flags → environment → config file**.

| | |
|---|---|
| Config file | `$XDG_CONFIG_HOME/smphe/config.json` (that is, `~/.config/smphe/config.json`). An existing `~/.smphe-client/config.json` from earlier versions keeps working and keeps being used — nothing is moved behind your back. Directory `700`, file `600` |
| Host | `SMPHE_HOST` overrides the file |
| Project | `--project` > `SMPHE_PROJECT` > the saved project |
| Token | `SMPHE_TOKEN_FILE` (a path) > `SMPHE_TOKEN` > the file |

**Secrets do not belong in environment variables.** They are inherited by every child process, show up
in `docker inspect` and in systemd's unit state, and end up in crash dumps — which is why clig.dev
says not to put them there. `SMPHE_TOKEN` exists because CI systems expect it, but `SMPHE_TOKEN_FILE`
wins over it and is what containers and pipelines should use. To store the token:

```bash
echo "$TOKEN" | smphe login --token-stdin   # never in argv: that lands in your shell history and in `ps`
```

`smphe config show` tells you which value comes from where, so a forgotten `export` cannot redirect
your commands in silence.

With `NODE_ENV=development` the CLI refuses to talk to a non-local host — verify against a throwaway
Semaphore, not against the one people depend on. `SMPHE_ALLOW_REMOTE=1` lifts it, deliberately.

## CLI

The package includes a CLI tool `smphe` for interacting with Semaphore UI from the command line.

### Installation

```bash
npm install -g @gzl10/semaphore-client
```

### Configuration

```bash
smphe config set host http://semaphore.example.com:3000
echo "$TOKEN" | smphe login --token-stdin
smphe use <projectId>          # set active project
```

Where it is stored, what overrides what, and why the token should not live in an environment
variable: [Configuration and secrets](#configuration-and-secrets).

### Usage

```bash
# Who am I and what can this token do?
smphe whoami
smphe whoami --project 5 --json

# Project management
smphe projects list
smphe projects get <id>
smphe projects create --name "My Project"
smphe projects update <id> --name "New Name"
smphe projects delete <id>

# Run a task
smphe tasks run <templateId>
smphe tasks run <templateId> --wait --progress       # block until it ends; exit code = how
smphe tasks run <templateId> --arguments '["--tags","deploy"]' --debug-level 2
smphe tasks run <templateId> --playbook site.yml --limit webservers --dry-run --diff
smphe tasks run <templateId> --tags deploy --skip-tags slow --environment '{"version":"1.2"}'
smphe tasks run <templateId> --git-branch release --message "Hotfix 1.2.1"
smphe tasks run <deployTemplateId> --build-task-id 118  # default: the latest successful build
smphe tasks run <tfTemplateId> --plan --wait          # terraform/tofu: plan only
smphe tasks wait <taskId> --timeout 600              # wait for a task already running
smphe tasks stop <taskId>                            # a finished task is left as it is
smphe tasks stop <taskId> --force                    # kills a running task; a queued one is stopped normally
smphe tasks output <taskId>

# List tasks: --status filters on the client; --count/--before page through them
smphe tasks list --status error
smphe tasks list --count 50                          # newest 50; a full page prints "next page: --before <id>" on stderr
smphe tasks list --count 50 --before 1234

# Templates
smphe templates create --name "Deploy app" --playbook deploy.yml --description "Rolls out the app" …
smphe templates update <id> --limit web01 --tags deploy   # merged into the template's task_params
smphe templates update <id> --no-limit                    # clear one key of task_params

# Restore a backup as a new project, next to the original
smphe backup restore --file backup.json --name "My Project (restored)"

# List templates, keys, inventory, environment, repositories, schedules, users
smphe templates list
smphe keys list
smphe inventory list
smphe environment list
smphe repositories list
smphe schedules list
smphe users list

# Output as JSON (for piping with jq)
smphe tasks list --json | jq '.[].status'

# Override project per command
smphe tasks list --project 5
# or via env var
SMPHE_PROJECT=5 smphe tasks list
```

Every `update` command answers `{ok, message, id, <resource>}` with `--json` (templates, schedules,
inventory, environments, repositories, keys, integrations, views, projects and workflows): the object
as stored after the write, read back from the server.

### Waiting for a task: exit codes

`smphe tasks run --wait` and `smphe tasks wait <taskId>` block until the task ends, and the exit code
says how:

| Exit | Meaning |
|------|---------|
| `0` | the task ended in `success` |
| `1` | `smphe` itself failed (bad input, API error…), as in every command |
| `2` | the task ended in `error` |
| `3` | the task was `stopped` |
| `4` | the task was `rejected` at an approval gate |
| `124` | `--timeout <seconds>` expired; the task keeps running in Semaphore |

stdout carries a single document — the last state of the task, as JSON with `--json` — so
`| jq .status` works; it is printed on `4` and `124` too. Everything else (the "waiting" notice,
`--progress` status changes) goes to stderr. A task waiting for approval (`waiting_confirmation`) is
waited for until somebody approves or rejects it, or `--timeout` expires. If the connection is lost
while waiting, the task is not affected: `smphe tasks wait <taskId>` picks it up again.

## Task overrides that the server silently drops

Semaphore accepts every override you send with a task and answers 201, but the
executor only applies some of them when the **template** enables it:

| Flag | Applied when | Template setting |
|------|--------------|------------------|
| `--limit` | the template allows it (ansible) | Allow override limit in task |
| `--tags` / `--skip-tags` | the template allows it (ansible) | Allow override tags / skip tags |
| `--inventory-id` | the template allows it (ansible) | Allow override inventory |
| `--arguments` | the template allows it | Allow override args in task |
| `--git-branch` | the template allows it | Allow override branch in task |
| `--debug` / `--debug-level` | the template allows it (ansible) | Allow debug |
| `--auto-approve` (terraform) | the template allows it | Allow auto approve (or Auto approve) |
| `--destroy` (terraform) | **always** — see below | Allow destroy |
| `--playbook`, `--dry-run`, `--diff` | ansible templates only | — |
| `--plan`, `--upgrade`, `--reconfigure` | terraform/tofu/terragrunt only | — |
| `--environment`, `--message`, `--build-task-id` | always | — |

Without the setting the value is stored and ignored: a playbook aimed at one host
quietly runs on every host, extra arguments vanish, `--debug` prints nothing
special. On the wrong kind of template it is worse: a bash, python or terraform
template stores `--playbook`, `--dry-run` or `--diff` and runs its own script, for
real. The ansible overrides are refused on any other app even if the template kept
an *Allow override* setting from when it was ansible. `smphe tasks run` reads the
template first and refuses the run instead of letting any of that happen:

```console
$ smphe tasks run 6 --limit web02.example.test
Error: Template 6 ("Update web servers") would silently ignore --limit: Semaphore accepts
the task and then runs it without them.
  --limit: enable "Allow override limit in task" in the template settings.
  The template has no limit of its own: every host of the inventory would run.
```

`--destroy` is the opposite trap: Semaphore does **not** check the template's
*Allow destroy*, so a task with `destroy` destroys whatever the template manages.
`smphe` refuses it unless the template allows it; set that with
`templates create/update --allow-destroy` (and `--allow-auto-approve`, `--auto-approve`,
`--override-backend`, each with a `--no-` form, on terraform/tofu/terragrunt templates). Other checks before the task is
created: `--environment` must be a JSON object of extra variables (anything else
leaves a task in `error` and a 500), `--inventory-id` must be an inventory of the
project (one from another project is silently replaced by the template's), and a
**deploy** template gets the latest successful build of its build template unless
`--build-task-id` says which (a successful task of that build template) — without one
the deploy runs with no version.

**If the template cannot be read**, every flag that changes *what* runs fails closed:
`--limit`, `--tags`, `--skip-tags`, `--inventory-id`, `--git-branch`, `--arguments`,
`--playbook`, `--build-task-id`, `--dry-run`, `--plan` and `--destroy` refuse to run,
because without the template the CLI cannot check its settings or its app. What does
no harm if dropped still goes through: `--debug`/`--debug-level`, `--diff`,
`--message`, `--upgrade`/`--reconfigure`, and `--auto-approve` (if dropped, a
terraform task waits for approval).

**`--dry-run` is checked twice.** Before the run, as above: only ansible templates
honour it, and the CLI refuses it anywhere else. After the run, the task Semaphore
created must carry `dry_run`; if it does not, it is not a check, so the CLI stops it
and fails, saying whether it had already started.

These checks live in the CLI. The library's `tasks.run()` sends what you pass it, so
code that uses it directly should read the template first (`templates.get()`).

Also worth knowing when debugging: the `limit` field of a task is **always empty**
in the API. It is `db:"-"` and deprecated; the effective value lives in
`params.limit`.

### Schedules: `enabled` is `active`

The API field is `active` and the server never sends `enabled`. This client
normalizes it, so `schedule.enabled` and `schedule.active` both hold the real
value, and `schedules.update()` merges against the current state before the PUT —
the server's PUT is full-replace, so a partial update used to reset `active` to
false and pause the schedule just for changing its cron.

Whether a schedule is recurring or one-shot is its `type`, and Semaphore drops the
field that does not match it: `schedules.update()` sets `type` from `cronFormat` or
`runAt` when you pass one of them without a `type`, so `smphe schedules update
--run-at` turns a cron schedule into a one-shot one (and `--cron` the other way);
both at once are refused.

`schedules create/update` and `integrations create/update` take `--limit`, `--tags`
and `--skip-tags` for the task they launch, and refuse them when the template would
ignore them, as `tasks run` does.

### Integrations: `searchable` decides which alias works, and only one of them does

An integration is fired through an alias, and the `searchable` flag silently
picks which alias that is — the two are mutually exclusive:

- `searchable: false` — only its **own** alias fires it, and its matchers are
  **never evaluated** (`ReceiveIntegration` skips them for a single-level alias).
- `searchable: true` — its own alias stops working (the lookup returns "not
  found"), and it is reachable only through the **project-wide** alias, which
  offers the request to every searchable integration and runs the ones whose
  matchers all match. One with no matchers never fires this way.

The server never says which of the two you have built. A request that matches
nothing, fails authentication or hits a dead alias is answered the same as one
that ran a task, so `smphe integrations aliases create` and `matchers create`
warn on stderr when the combination cannot fire. The one reliable signal is the
response headers: a request that started a task carries `X-Semaphore-Task-ID`.

The other sharp edge is deletion: deleting an integration removes its own
aliases, but a **project-wide alias outlives every integration** and keeps
answering, so it has to be deleted on its own.

### Admin surface: three traps worth knowing before you use it

`apps` administration, global `roles` and the instance task pool all sit behind the
global-admin middleware: a token whose user is not an admin gets **403 with an empty
body** on every one of them.

- **`PUT /apps/{id}` is also the create.** The server does not validate the id, so an
  unknown one creates the app. But the id becomes part of an option key
  (`apps.<id>.<field>`), validated against `^[\w.]+$` — **a hyphen breaks it**, and
  because the server writes one option per field and stops at the first rejected key,
  the 500 arrives with some fields already written. Which ones depends on Go map
  ordering: three identical requests left three different states. This client refuses
  such ids before sending anything.
- **`GET /tasks` is not task history.** It is the server's in-memory pool: only what is
  queued or running right now, with a `location` field. `GET /tasks/{id}` is routed to
  the same handler and ignores the id, which is why there is no `instanceTasks.get()`.
  `DELETE /tasks/{id}` does not delete either — it stops the task, and answers 204
  whether or not the id was in the pool, so a 204 is no evidence anything was stopped.
- **Global roles are not a PRO feature**, despite the controller living in the PRO
  package and `custom_roles_management` reporting `false`. Verified working on the
  plain OSS image. Runners and the Terraform backend genuinely are PRO and are not
  covered here.

As everywhere else in this API, the PUTs are full replaces: a partial body leaves an
app `active: false` with `priority: 0`, and a role with `permissions: 0`. Every
`update()` here reads and merges first.

## Token permissions

A Semaphore API token inherits the permissions of the user that created it, so a
token is not automatically allowed to do everything the CLI can express. Roles and
their permission bitmask come from the server (`db/ProjectUser.go`):

| Role | Bitmask | Can |
|------|---------|-----|
| `guest` | 0 | nothing but reads |
| `task_runner` | 1 | run/stop tasks and workflow runs |
| `manager` | 5 | the above + create/update project resources (templates, keys, repos, inventory, environment, schedules, views, workflows) |
| `owner` | 15 | the above + update/delete the project and manage its members |

Two things are easy to get wrong:

- **Reads are never gated.** The server's permission middleware only rejects
  non-`GET`/`HEAD` requests, so any project member lists templates, keys and tasks
  regardless of role. A token that fails to *create* a template still lists them.
- **Creating a project answers 401, not 403** — it is checked against the user's
  global `admin` flag plus `NonAdminCanCreateProject`, not against the project role.
  That 401 does not mean the token expired. This also applies to `backup restore`,
  which always creates a new project.

`smphe whoami` shows exactly where a token stands:

```console
$ smphe whoami
host:      https://semaphore.example.com
user:      ci (CI service)
admin:     no
projects:  cannot create
project:   1
role:      task_runner
perms:     run_tasks
can:
  + run tasks (smphe tasks run/stop)
cannot:
  - create/update project resources (templates, keys, repos, inventory, environment, schedules, views, workflows)
  - update/delete the project itself
  - manage project members
Reads are always allowed regardless of role.
```

When a write is rejected, the CLI says what is missing instead of a bare 403:

```console
$ smphe templates create -p 1 --name deploy ...
Error: Semaphore API 403: Forbidden
  Your token (user "ci") has role "task_runner" in project 1 (permissions: run_tasks).
  This operation needs "manage_resources", granted by role: manager or owner.
  Reads are always allowed; only writes are gated. Run `smphe whoami` for the full picture.
```

From the library, the same data is available as `client.users.me()` and
`client.projects.getRole(projectId)`, plus the `ProjectPermission`,
`ROLE_PERMISSIONS`, `describePermissions()`, `rolesGranting()` and
`requiredPermissionFor()` helpers.

> A `task_runner` token is the right choice for CI and agents: it runs playbooks
> but cannot rewrite them. Only raise it to `manager` if the automation genuinely
> has to create resources.

## Disaster Recovery

Rebuild a complete Semaphore project from scratch using only `smphe`:

```bash
# 1. SSH key (from file or inline)
smphe keys create --name "deploy" --type ssh --private-key-file ~/.ssh/id_ed25519
KEY_ID=$(smphe keys list --json | jq '[.[] | select(.name=="deploy")][0].id')

# Login key
smphe keys create --name "vault-login" --type login --login admin --password secret

# 2. Repository
smphe repositories create \
  --name "infra" \
  --git-url "https://gitlab.example.com/ops/infra.git" \
  --git-branch main \
  --ssh-key-id "$KEY_ID"
REPO_ID=$(smphe repositories list --json | jq '[.[] | select(.name=="infra")][0].id')

# 3. Inventory (inline or from file)
smphe inventory create \
  --name "infra" \
  --type static \
  --ssh-key-id "$KEY_ID" \
  --inventory-file ./hosts.ini
INV_ID=$(smphe inventory list --json | jq '[.[] | select(.name=="infra")][0].id')

# 4. Environment variables
smphe environment create --name "app" --var TZ=UTC --var LOG_LEVEL=info
# or from a .env file (vars override .env values):
smphe environment create --name "app" --from-env /opt/app/.env --var OVERRIDE=val
# real secrets (stored as secrets; the API never returns their value):
smphe environment create --name "secrets" --secret-env DB_PASSWORD=s3cr3t --secret-var api_token=t0k3n
ENV_ID=$(smphe environment list --json | jq '[.[] | select(.name=="app")][0].id')

# 5. Template
smphe templates create \
  --name "Deploy app" \
  --playbook "ansible/playbooks/deploy.yml" \
  --inventory-id "$INV_ID" \
  --repository-id "$REPO_ID" \
  --environment-id "$ENV_ID"
```

### `keys create` flags

| Flag | Description |
|------|-------------|
| `--type ssh\|login_password\|string\|none` | Key type (required). `login` is accepted as an alias of `login_password` |
| `--private-key <content>` | SSH private key content (inline) |
| `--private-key-file <path>` | Read SSH private key from file |
| `--login <user>` | Username of a `login_password` key, or the SSH user of an `ssh` key |
| `--password <pass>` | Password, for `login_password` keys only |
| `--passphrase <pass>` | Passphrase of an encrypted SSH private key (`ssh` keys only) |
| `--string <value>` | The value of a `string` key (a token, an API key…) |

### `keys update` flags

All flags are optional; at least one must be provided.

| Flag | Description |
|------|-------------|
| `--name <name>` | Rename the key |
| `--type ssh\|login_password\|string\|none` | Change key type (`login` is accepted as an alias of `login_password`) |
| `--private-key <content>` | Replace SSH private key (inline) |
| `--private-key-file <path>` | Replace SSH private key from file |
| `--login <user>` | Replace login username (with `--password`), or the SSH user (with `--private-key[-file]`) |
| `--password <pass>` | Replace login password (`--login` required) |
| `--passphrase <pass>` | SSH passphrase; needs `--private-key[-file]`, because the SSH secret is rewritten whole and never read back |
| `--string <value>` | Replace the value of a `string` key |

Flags of another key type are refused, checked against the key's stored type (or the new `--type`):
`--string` on an `ssh` key would otherwise wipe the stored secret. Retyping a `login_password` key
that an authenticated integration uses is refused too.

### `environment create` flags

| Flag | Description |
|------|-------------|
| `--var KEY=VALUE` | Environment variable, plain (repeatable) |
| `--extra-var KEY=VALUE` | Extra variable (ansible `--extra-vars`), plain (repeatable) |
| `--secret-var KEY=VALUE` | **Secret** extra variable (repeatable) |
| `--secret-env KEY=VALUE` | **Secret** environment variable (repeatable) |
| `--from-env <path>` | Load environment variables from a `.env` file |
| `--password <key>` | **Deprecated, and Semaphore never uses it** (it prints a warning). The ansible vault password goes in the template's vaults: `templates create/update --vault-key-id <login_password key>` |
| `--secret` | **Deprecated, and it encrypts nothing**: it just puts `--var`/`--from-env` in the extra variables field. Use `--secret-var` / `--secret-env` for actual secrets |

### `environment update` flags

Same as above, plus `--delete-secret <name>` (and `--delete-secret-var` / `--delete-secret-env` when
the same name exists in both quadrants). `--var` and `--extra-var` **replace** their field; secrets
are added, or updated when the name already exists.

The GET of a variable group returns its `password` in clear text. `environment list` no longer has a
Password column, `environment get` does not print it, and with `--json` it is masked as `********`
(the library still returns it as the server sends it).

### Integration auth needs a `login_password` key

Every auth method (`token`, `hmac`, `github`, `bitbucket`, `basic`) reads its secret from the
**password of a `login_password` key** (`--auth-secret-id`). With a `string`, `ssh` or `none` key the
secret is empty and publicly known: with `token` a request without the header fires the webhook, with
`hmac`/`github`/`bitbucket` anyone can sign with an empty key, with `basic` empty credentials pass
(verified on Semaphore 2.19.12 for `token`, `hmac` and `basic`; `github`/`bitbucket` use the same HMAC
code). An auth method with **no key at all** is just as open: Semaphore accepts it, and a request without
the header fires the webhook (verified on 2.19.12 with `token`).

So `integrations.create()` and `update()` (and the CLI commands built on them) require a key for any
auth method, read it, and refuse any type but `login_password`. `update()` checks on every call with
an auth method, not only when it changes: an integration already set up with another key type cannot
be saved again as it is until its key is fixed. `keys.update()` refuses to retype a `login_password`
key that an authenticated integration uses.

### `inventory create` flags

| Flag | Description |
|------|-------------|
| `--inventory <content>` | Inventory content (inline); with `--type file`, the **path** of the inventory file inside the repository |
| `--inventory-file <path>` | Read inventory content from a local file (static types; refused with `--type file`) |
| `--ssh-key-id <id>` | Optional: a static inventory works without a key (the API returns `ssh_key_id: null`) |
| `--repository-id <id>` | `--type file` only: repository holding the file (default: the template's) |
| `--runner-tag <tag>` | Run on runners with this tag (runners are Semaphore PRO) |

`inventory update` takes the same flags, plus `--no-repository-id` (back to the template's repository;
changing to a type other than `file` unlinks it too).

### `templates create/update` flags

`smphe templates create --help` lists them all; the ones that need a word:

| Flag | Description |
|------|-------------|
| `--description <text>` | Template description. On `update` it is written through its own endpoint, which touches nothing else; `""` clears it |
| `--limit`, `--tags`, `--skip-tags` | Ansible values of the template (repeatable). On `update` they are merged into `task_params` key by key: the other keys and the `--allow-*` settings are kept |
| `--no-limit`, `--no-tags`, `--no-skip-tags` | `update` only: clear that one key of `task_params` |
| `--allow-override-limit`, `--allow-override-tags`, `--allow-override-skip-tags`, `--allow-override-inventory`, `--allow-debug` | Ansible: let a task override that value (see [Task overrides](#task-overrides-that-the-server-silently-drops)) |
| `--allow-override-args`, `--allow-override-branch` | Let a task override the CLI args / the branch |
| `--vault-key-id <[name=]id>` | Ansible vault password from a `login_password` key (repeatable; name each one when there are several). On `update` it replaces the template's vaults |
| `--[no-]allow-destroy`, `--[no-]allow-auto-approve`, `--[no-]auto-approve`, `--[no-]override-backend` | Terraform/tofu/terragrunt templates only |

The library behaves the same way: `templates.update(projectId, id, { taskParams })` merges key by
key over the stored `task_params`, so to clear a value you send it as `false` or `[]`.

### `workflows` (Semaphore >= 2.19)

| Command | Description |
|---------|-------------|
| `workflows list` / `get <id>` | List workflows / show one with its graph |
| `workflows create --file <graph.json>` | Create from a JSON graph |
| `workflows update <id> [--file] [--name]` | Partial update: what you omit is kept |
| `workflows run <id>` | Start a run (returns `root_task_id`) |
| `workflows runs <id>` / `stop <id> <runId>` | List runs / stop one |
| `workflows approvals <id> <runId>` | Pending approval gates |
| `workflows approve\|reject <id> <runId> <nodeId>` | Resolve a gate |

### `integrations`

Webhook entry points: an external request to `/api/integrations/{alias}` runs a
template, with matchers deciding which requests count and extract values turning
parts of the request into task variables.

| Command | Description |
|---------|-------------|
| `integrations list` / `get <id>` | List integrations / show one |
| `integrations create --name <n> --template-id <id>` | Create one; `--auth-method`, `--auth-secret-id`, `--auth-header`, `--searchable`, and `--limit`/`--tags`/`--skip-tags` for the task it launches |
| `integrations update <id> [...]` | Partial update: what you omit is kept (`--limit`/`--tags`/`--skip-tags` are merged over the stored ones) |
| `integrations delete <id>` | Delete it and its own aliases |
| `integrations matchers list\|get\|create\|update\|delete\|refs` | Conditions a request must meet |
| `integrations values list\|get\|create\|update\|delete\|refs` | Parts of the request that become task variables |
| `integrations aliases list\|create\|delete [--integration <id>]` | Public URLs; without `--integration` they are project-wide |

The alias string cannot be chosen: the server generates a random one and returns
only `{id, url}`, so this client fills in `alias` from the last segment of that
URL. `integrations refs` has no CLI command because the endpoint is a stub on
2.19.8 — it answers `{matchers: null, values: null}` whatever the integration
holds.

```bash
# An authenticated hook that runs template 44 and passes the pushed branch in
# (key 24 is a login_password key: its password is the token)
smphe integrations create --name deploy --template-id 44 \
  --auth-method token --auth-secret-id 24 --auth-header X-Hook-Token
smphe integrations values create 1 --name branch --value-source body \
  --key ref --variable DEPLOY_BRANCH
smphe integrations aliases create --integration 1 --json
```

### `apps`, `roles`, `instance` (admin)

| Command | Description |
|---------|-------------|
| `apps list [--all]` | Apps a template can use; `--all` includes the disabled ones |
| `apps get <appId>` | Show one app (the id is added back: the server does not echo it) |
| `apps set <appId> [...]` | Create or update an app; what you omit is kept |
| `apps enable\|disable <appId>` | Flip the switch without rewriting the rest |
| `apps delete <appId>` | Remove it from the whole instance |
| `roles list` / `get <slug>` | Global roles |
| `roles create <slug> --name <n> [--permissions <bitmask>]` | Create one |
| `roles update <slug> [...]` / `delete <slug>` | Update (merging) or delete |
| `instance tasks [--queued\|--running]` | What is queued or running right now, every project |
| `instance stop <taskId>` | Stop a pooled task; says whether it was actually there |

### `backup`

| Command | Description |
|---------|-------------|
| `backup export [--file <path>]` | Export a project as JSON (stdout, or file with mode 600) |
| `backup restore --file <path> [--name <name>]` | Restore as a NEW project (never overwrites). `--name` gives it another name, to restore a copy next to the original: Semaphore refuses a name that already exists |

## License

MIT
