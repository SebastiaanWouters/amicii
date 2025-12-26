# Amicii

Lightweight agent coordination server. CLI-first messaging and file reservations for multi-agent workflows.

## Install

### One-liner (Ubuntu/Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/sebastiaanwouters/amicii/main/install.sh | bash
```

### Manual

```bash
# Install Bun (if not installed)
curl -fsSL https://bun.sh/install | bash

# Clone and setup
git clone https://github.com/sebastiaanwouters/amicii.git
cd amicii
bun install
bun link  # Creates global `am` command
```

## Quick Start

```bash
# Start server (in tmux or screen for background)
am serve

# Register agent identity
cd /path/to/project
am agent register --program claude --model opus

# Send message
am send --to GreenLake --subject "Starting work" --body "Working on auth"

# Check inbox
am inbox

# Reserve files before editing
am reserve "src/auth/**" --reason bd-42

# Release when done
am release --all
```

## Configuration

Config file: `~/.amicii/config.json`

```json
{
  "port": 8765,
  "retention_days": 30
}
```

Data stored in:
- Database: `~/.amicii/storage.sqlite`
- PID file: `~/.amicii/amicii.pid`
- Log file: `~/.amicii/amicii.log`

## Commands

### Server

| Command | Description |
|---------|-------------|
| `am serve [--port N]` | Start server (manage with tmux/systemd) |
| `am stop` | Stop server by PID |
| `am status` | Server status and stats |

### Project

| Command | Description |
|---------|-------------|
| `am project ensure [path]` | Create/ensure project (default: pwd) |
| `am project list` | List all projects |
| `am project info [path]` | Show project details |

### Agent

| Command | Description |
|---------|-------------|
| `am agent register [options]` | Register agent identity |
| `am agent whois <name>` | Get agent profile |
| `am agent list` | List agents in project |

Options for `am agent register`:
- `--name <hint>` - Name hint (auto-generated if invalid)
- `--program <name>` - Program name (e.g., claude, codex)
- `--model <name>` - Model name (e.g., opus, o3)
- `--task <description>` - Task description

### Messaging

| Command | Description |
|---------|-------------|
| `am send [options]` | Send a message |
| `am inbox [options]` | View inbox |
| `am outbox [--limit N]` | View sent messages |
| `am read <id>` | Mark as read and display |
| `am ack <id>` | Acknowledge message |

Options for `am send`:
- `--to <agent>[,...]` - Recipients (use "all" for broadcast)
- `--cc <agent>[,...]` - CC recipients
- `--subject <text>` - Subject line (required)
- `--body <text>` - Message body
- `--body-file <path>` - Read body from file
- `--thread <id>` - Thread ID (e.g., bd-123)
- `--urgent` - Mark as urgent
- `--ack` - Request acknowledgement

Options for `am inbox`:
- `--limit <n>` - Limit results (default: 20)
- `--urgent` - Only urgent messages
- `--unread` - Only unread messages
- `--since <iso>` - Messages since timestamp

### File Reservations

| Command | Description |
|---------|-------------|
| `am reserve <pattern> [options]` | Reserve files |
| `am release [pattern] [--all]` | Release reservations |
| `am reservations [--active]` | List reservations |

Options for `am reserve`:
- `--ttl <seconds>` - TTL in seconds (default: 3600)
- `--reason <text>` - Reason (e.g., bd-123)
- `--shared` - Shared (non-exclusive) reservation

### Search

| Command | Description |
|---------|-------------|
| `am search <query> [--limit N]` | Search messages (FTS5) |

### Config

| Command | Description |
|---------|-------------|
| `am config` | Show current config |
| `am config set <key> <value>` | Set config value |

Valid keys: `port`, `retention_days`

## Beads Integration

Use beads task IDs as thread IDs and reservation reasons:

```bash
# Get ready work
bd ready --json | jq -r '.[0].id'  # → bd-42

# Reserve + announce
am reserve "src/**" --reason bd-42
am send --to all --subject "[bd-42] Starting" --thread bd-42

# Work...

# Complete
bd close bd-42
am release --all
am send --to all --subject "[bd-42] Done" --thread bd-42
```

## Architecture

```
~/.amicii/
├── config.json      # Port, retention settings
├── storage.sqlite   # SQLite database (WAL mode, FTS5)
├── amicii.pid       # Daemon PID file
└── amicii.log       # Daemon log file
```

### Database Schema

- `projects` - Project registry (slug, human_key path)
- `agents` - Agent identities (adjective+noun names)
- `messages` - Message storage with FTS5 search
- `message_recipients` - Delivery and read/ack tracking
- `file_reservations` - Advisory file locking with TTL

### Performance

- WAL mode for concurrent reads
- FTS5 full-text search with bm25 ranking
- Indexed queries for inbox/outbox
- Automatic retention cleanup (default: 30 days)
- Expired reservation auto-release

## AGENTS.md Blurb

Add this to your project's AGENTS.md:

```markdown
## Amicii: Agent Coordination

Lightweight CLI for agent messaging and file reservations. Optimized for beads/bv workflows.

### Setup
\`\`\`bash
am serve            # Start server (run in tmux for background)
am agent register   # Get identity per project
\`\`\`

### Beads Workflow
\`\`\`bash
# 1. Pick task
bd ready --json | jq -r '.[0].id'     # → bd-42

# 2. Reserve + announce
am reserve "src/**" --reason bd-42
am send --to all --subject "[bd-42] Starting" --thread bd-42

# 3. Work... check inbox periodically
am inbox --unread

# 4. Complete
bd close bd-42
am release --all
am send --to all --subject "[bd-42] Done" --thread bd-42
\`\`\`

### Commands
| Command | Purpose |
|---------|---------|
| `am inbox` | Check messages |
| `am send --to X --subject Y` | Send message |
| `am reserve <pattern>` | Reserve files (advisory) |
| `am release` | Release reservations |
| `am ack <id>` | Acknowledge message |

### File Reservations
- Advisory locks signaling intent
- Use `--reason bd-###` for beads tasks
- Default TTL: 1 hour
- Conflicts reported when overlapping exclusive reservations exist

### With bv
\`\`\`bash
bv --robot-priority   # Task recommendations
bv --robot-plan       # Parallel tracks
\`\`\`
```

## License

MIT
