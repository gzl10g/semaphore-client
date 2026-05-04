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

## Using with AI agents (Claude, Codex, etc.)

Any agent with bash access can drive Semaphore through the `smphe` CLI with no extra code. Install it globally and point the agent at the commands — JSON output makes it easy to pipe into further processing:

```bash
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

## License

MIT
