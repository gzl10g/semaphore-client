# @gzl10/semaphore-client

Typed HTTP client for [Semaphore UI](https://semaphoreui.com/) API. Zero runtime dependencies. ESM-only, Node ≥20.

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
| `templates` | `list`, `get`, `create`, `update`, `delete` |
| `views` | `list`, `get`, `create`, `update`, `delete` |
| `tasks` | `list`, `get`, `run`, `stop`, `output`, `waitForCompletion` |
| `schedules` | `list`, `get`, `create`, `update`, `delete` |
| `users` | `list`, `get`, `create`, `update`, `delete` |
| `workflows` | `list`, `get`, `create`, `update`, `delete`, `run`, `listRuns`, `getRun`, `stopRun`, `listApprovals`, `resolveApproval` |
| `backup` | `export`, `restore` |

## Key features

### Run a playbook and wait for the result

```ts
const task = await client.tasks.run(projectId, {
  templateId: 42,
  limit: 'webservers',                                // restrict to a host group
  environment: JSON.stringify({ target_env: 'prod' }), // extra vars (JSON string)
  arguments: '--tags deploy',                          // extra CLI args
})

const result = await client.tasks.waitForCompletion(projectId, task.id, {
  pollInterval: 3000,  // ms between polls (default: 2000)
  timeout: 600_000,    // ms max wait (default: no limit)
  signal,              // AbortSignal for external cancellation
})

// If timeout is reached, the task keeps running in Semaphore.
// Call tasks.stop() to cancel it.
if (result.status === 'error') {
  const output = await client.tasks.output(projectId, task.id)
  console.error(output.map(l => l.output).join('\n'))
}
```

### Filter tasks by status

```ts
// Only fetch failed tasks — server-side filtering
const failed = await client.tasks.list(projectId, { status: 'error' })
const running = await client.tasks.list(projectId, { status: 'running' })
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

### Variable groups (environments)

The `environment.password` field is the **ansible-vault key** used to encrypt `json` and `env` fields — not an authentication password.

```ts
await client.environment.create({
  projectId,
  name: 'prod-secrets',
  password: vaultKey,                         // ansible-vault encryption key
  json: JSON.stringify({ db_password: '…' }), // encrypted at rest
})
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

## Using with AI agents (Claude, Codex, etc.)

Any agent with bash access can drive Semaphore through the `smphe` CLI with no extra code. Install it globally and point the agent at the commands — JSON output makes it easy to pipe into further processing:

```bash
# What is this token allowed to do?
smphe whoami --json

# Discover available playbooks
smphe templates list --json

# Run a playbook and get the task ID
smphe tasks run 42 --limit webservers --json

# Poll output once the task is running
smphe tasks output <taskId> --json

# Manage schedules
smphe schedules list --json
smphe schedules update <id> --enabled false
```

## CLI

The package includes a CLI tool `smphe` for interacting with Semaphore UI from the command line.

### Installation

```bash
npm install -g @gzl10/semaphore-client
```

### Configuration

```bash
smphe config set host http://your-semaphore-host:3000
smphe login --token YOUR_API_TOKEN
smphe use <projectId>          # set active project
```

Config is stored in `~/.smphe-client/config.json` (token-protected, chmod 600).

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
smphe tasks run <templateId> --arguments '{"key":"value"}' --debug
smphe tasks run <templateId> --playbook site.yml --limit webservers
smphe tasks stop <taskId>
smphe tasks output <taskId>

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

## Task overrides that the server silently drops

Semaphore accepts every override you send with a task and answers 201, but the
executor only applies some of them when the **template** enables it:

| Flag | Applied when | Template setting |
|------|--------------|------------------|
| `--limit` | the template allows it | Allow override limit in task |
| `--arguments` | the template allows it | Allow override args in task |
| `--debug` | the template allows it | Allow debug |
| `--playbook` | always | — |
| `--environment` | always | — |
| `--dry-run` | always | — |

Without the flag the value is stored and ignored: a playbook aimed at one host
quietly runs on every host, extra arguments vanish, `--debug` prints nothing
special. `smphe tasks run` checks the template first and refuses the run instead
of letting that happen:

```console
$ smphe tasks run 6 --limit pve-n2.server.arpa
Error: Template 6 ("Update Proxmox") would silently ignore --limit: Semaphore accepts
the task and then runs it without them.
  --limit: enable "Allow override limit in task" in the template settings.
  The template has no limit of its own: every host of the inventory would run.
```

Also worth knowing when debugging: the `limit` field of a task is **always empty**
in the API. It is `db:"-"` and deprecated; the effective value lives in
`params.limit`.

### Schedules: `enabled` is `active`

The API field is `active` and the server never sends `enabled`. This client
normalizes it, so `schedule.enabled` and `schedule.active` both hold the real
value, and `schedules.update()` merges against the current state before the PUT —
the server's PUT is full-replace, so a partial update used to reset `active` to
false and pause the schedule just for changing its cron.

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
  --name "homelab" \
  --git-url "https://gitlab.example.com/infra/homelab.git" \
  --git-branch main \
  --ssh-key-id "$KEY_ID"
REPO_ID=$(smphe repositories list --json | jq '[.[] | select(.name=="homelab")][0].id')

# 3. Inventory (inline or from file)
smphe inventory create \
  --name "homelab" \
  --type static \
  --ssh-key-id "$KEY_ID" \
  --inventory-file ./hosts.ini
INV_ID=$(smphe inventory list --json | jq '[.[] | select(.name=="homelab")][0].id')

# 4. Environment variables
smphe environment create --name "devops" --var TZ=Europe/Madrid --var LOG_LEVEL=info
# or from a .env file (vars override .env values):
smphe environment create --name "devops" --from-env /opt/homelab/.env --var OVERRIDE=val
# encrypted with ansible-vault:
smphe environment create --name "secrets" --secret --var DB_PASSWORD=s3cr3t --password my-vault-key
ENV_ID=$(smphe environment list --json | jq '[.[] | select(.name=="devops")][0].id')

# 5. Template
smphe templates create \
  --name "Deploy devops" \
  --playbook "ansible/playbooks/deploy-devops.yml" \
  --inventory-id "$INV_ID" \
  --repository-id "$REPO_ID" \
  --environment-id "$ENV_ID"
```

### `keys create` flags

| Flag | Description |
|------|-------------|
| `--type ssh\|login\|none` | Key type (required) |
| `--private-key <content>` | SSH private key content (inline) |
| `--private-key-file <path>` | Read SSH private key from file |
| `--login <user>` | Username for login keys |
| `--password <pass>` | Password for login keys |

### `keys update` flags

All flags are optional; at least one must be provided.

| Flag | Description |
|------|-------------|
| `--name <name>` | Rename the key |
| `--type ssh\|login\|none` | Change key type |
| `--private-key <content>` | Replace SSH private key (inline) |
| `--private-key-file <path>` | Replace SSH private key from file |
| `--login <user>` | Replace login username |
| `--password <pass>` | Replace login password (`--login` required) |

### `environment create` flags

| Flag | Description |
|------|-------------|
| `--var KEY=VALUE` | Variable (repeatable) |
| `--from-env <path>` | Load variables from `.env` file |
| `--secret` | Send variables encrypted (`json` field, requires `--password` for ansible-vault) |

### `inventory create` flags

| Flag | Description |
|------|-------------|
| `--inventory <content>` | Inventory content (inline) |
| `--inventory-file <path>` | Read inventory content from file |
| `--ssh-key-id <id>` | Optional: a static inventory works without a key (the API returns `ssh_key_id: null`) |

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

### `backup`

| Command | Description |
|---------|-------------|
| `backup export [--file <path>]` | Export a project as JSON (stdout, or file with mode 600) |
| `backup restore --file <path>` | Restore as a NEW project (never overwrites) |

## License

MIT
