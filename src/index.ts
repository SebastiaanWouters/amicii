#!/usr/bin/env bun

import { loadConfig, updateConfig, isDaemonRunning, paths } from "./config.js";
import { startServer, stopServer } from "./server.js";
import { apiRequest, isServerRunning } from "./utils/api.js";
import { resolvePath } from "./utils/project-detect.js";
import { printJson, printTable, printError, printSuccess, formatTime, truncate } from "./utils/output.js";
import type {
  Project,
  Agent,
  Message,
  InboxMessage,
  MessageWithSender,
  ReservationWithAgent,
  ReservationResult,
  ServerStatus,
} from "./types.js";

const VERSION = "0.1.0";

function usage(): void {
  console.log(`
Amicii v${VERSION} - Agent Coordination Server

Usage: am <command> [options]

Server:
  serve [--port N]              Start server (manage with tmux/systemd)
  stop                          Stop server by PID
  status                        Server status and stats

Project:
  project ensure [path]         Create/ensure project (default: pwd)
  project list                  List all projects
  project info [path]           Show project details

Agent:
  agent register [options]      Register agent identity
    --name <hint>               Name hint (auto-generated if invalid)
    --program <name>            Program name (e.g., claude, codex)
    --model <name>              Model name (e.g., opus, o3)
    --task <description>        Task description
  agent whois <name>            Get agent profile
  agent list                    List agents in project

Messaging:
  send [options]                Send a message
    --to <agent>[,...]          Recipients (use "all" for broadcast)
    --cc <agent>[,...]          CC recipients
    --subject <text>            Subject line (required)
    --body <text>               Message body
    --body-file <path>          Read body from file
    --thread <id>               Thread ID (e.g., bd-123)
    --urgent                    Mark as urgent
    --ack                       Request acknowledgement
  inbox [options]               View inbox
    --limit <n>                 Limit results (default: 20)
    --urgent                    Only urgent messages
    --unread                    Only unread messages
    --since <iso>               Messages since timestamp
  outbox [--limit N]            View sent messages
  read <message-id>             Mark message as read and display
  ack <message-id>              Acknowledge message

File Reservations:
  reserve <pattern> [options]   Reserve files
    --ttl <seconds>             TTL in seconds (default: 3600)
    --reason <text>             Reason (e.g., bd-123)
    --shared                    Shared (non-exclusive) reservation
  release [pattern] [--all]     Release reservations
  reservations [--active]       List reservations

Search:
  search <query> [--limit N]    Search messages

Config:
  config                        Show current config
  config set <key> <value>      Set config value (port, retention_days)

Prune:
  prune [--dry-run]             Run retention cleanup

Examples:
  am serve                      Start server (use tmux for background)
  am agent register --program claude --model opus
  am send --to GreenLake --subject "Starting work" --body "On it!"
  am inbox --unread
  am reserve "src/**" --reason bd-42
  am release --all
`);
}

async function requireServer(): Promise<boolean> {
  if (!(await isServerRunning())) {
    printError("Server not running. Start with: am serve");
    return false;
  }
  return true;
}

function getProjectSlug(): string {
  const path = resolvePath();
  // Simple slug: use last path component
  return path.split("/").filter(Boolean).pop() ?? "unknown";
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
    usage();
    return;
  }

  const command = args[0];
  const subcommand = args[1];

  // Parse flags
  const flags: Record<string, string | boolean> = {};
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("--")) {
        flags[key] = nextArg;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }

  // Get positional args (non-flag args after command)
  const positional: string[] = [];
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      const prev = args[i - 1];
      if (!prev?.startsWith("--") || i === 1) {
        positional.push(arg);
      }
    }
  }

  switch (command) {
    // --- Server ---
    case "serve": {
      const port = typeof flags.port === "string" ? parseInt(flags.port) : loadConfig().port;
      startServer(port);
      break;
    }

    case "stop": {
      stopServer();
      break;
    }

    case "status": {
      const { running, pid } = isDaemonRunning();
      if (!running) {
        console.log("Server: not running");
        console.log(`Config: ${paths.config}`);
        console.log(`Database: ${paths.db}`);
        return;
      }

      const result = await apiRequest<ServerStatus>("GET", "/api/status");
      if (result.ok) {
        console.log(`Server: running (PID: ${pid})`);
        console.log(`Version: ${result.value.version}`);
        console.log(`Uptime: ${result.value.uptime_seconds}s`);
        console.log(`Projects: ${result.value.projects_count}`);
        console.log(`Agents: ${result.value.agents_count}`);
        console.log(`Messages: ${result.value.messages_count}`);
        console.log(`Active reservations: ${result.value.reservations_active}`);
        console.log(`Retention: ${result.value.retention_days} days`);
      } else {
        printError(result.error.message);
      }
      break;
    }

    // --- Project ---
    case "project": {
      if (!await requireServer()) return;

      if (subcommand === "ensure" || !subcommand) {
        const path = resolvePath(positional[1]);
        const result = await apiRequest<Project>("POST", "/api/project/ensure", { human_key: path });
        if (result.ok) {
          printSuccess(`Project: ${result.value.slug}`);
          console.log(`Path: ${result.value.human_key}`);
          console.log(`Created: ${result.value.created_at}`);
        } else {
          printError(result.error.message);
        }
      } else if (subcommand === "list") {
        const result = await apiRequest<Project[]>("GET", "/api/projects");
        if (result.ok) {
          printTable(result.value, [
            { key: "slug", label: "Slug", width: 30 },
            { key: "human_key", label: "Path", width: 50 },
            { key: "created_at", label: "Created", width: 20 },
          ]);
        } else {
          printError(result.error.message);
        }
      } else if (subcommand === "info") {
        const path = resolvePath(positional[1]);
        const result = await apiRequest<Project>("POST", "/api/project/ensure", { human_key: path });
        if (result.ok) {
          printJson(result.value);
        } else {
          printError(result.error.message);
        }
      }
      break;
    }

    // --- Agent ---
    case "agent": {
      if (!await requireServer()) return;

      if (subcommand === "register") {
        const path = resolvePath();
        // First ensure project
        const projectResult = await apiRequest<Project>("POST", "/api/project/ensure", { human_key: path });
        if (!projectResult.ok) {
          printError(projectResult.error.message);
          return;
        }

        const result = await apiRequest<Agent>("POST", "/api/agent/register", {
          project_slug: projectResult.value.slug,
          name: flags.name as string | undefined,
          program: (flags.program as string) || "unknown",
          model: (flags.model as string) || "unknown",
          task_description: flags.task as string | undefined,
        });
        if (result.ok) {
          printSuccess(`Agent registered: ${result.value.name}`);
          console.log(`Program: ${result.value.program}`);
          console.log(`Model: ${result.value.model}`);
          console.log(`Project: ${projectResult.value.slug}`);
        } else {
          printError(result.error.message);
        }
      } else if (subcommand === "whois") {
        const name = positional[1];
        if (!name) {
          printError("Agent name required");
          return;
        }
        const path = resolvePath();
        const projectResult = await apiRequest<Project>("POST", "/api/project/ensure", { human_key: path });
        if (!projectResult.ok) {
          printError(projectResult.error.message);
          return;
        }
        const result = await apiRequest<Agent>("GET", `/api/agent/${projectResult.value.slug}/${name}`);
        if (result.ok) {
          printJson(result.value);
        } else {
          printError(result.error.message);
        }
      } else if (subcommand === "list") {
        const path = resolvePath();
        const projectResult = await apiRequest<Project>("POST", "/api/project/ensure", { human_key: path });
        if (!projectResult.ok) {
          printError(projectResult.error.message);
          return;
        }
        const result = await apiRequest<Agent[]>("GET", "/api/agents", undefined, { project: projectResult.value.slug });
        if (result.ok) {
          printTable(result.value, [
            { key: "name", label: "Name", width: 20 },
            { key: "program", label: "Program", width: 15 },
            { key: "model", label: "Model", width: 15 },
            { key: "last_active_ts", label: "Last Active", width: 20 },
          ]);
        } else {
          printError(result.error.message);
        }
      }
      break;
    }

    // --- Messaging ---
    case "send": {
      if (!await requireServer()) return;

      const to = (flags.to as string)?.split(",").map(s => s.trim());
      const cc = (flags.cc as string)?.split(",").map(s => s.trim());
      const subject = flags.subject as string;
      let body = flags.body as string;

      if (flags["body-file"]) {
        try {
          body = await Bun.file(flags["body-file"] as string).text();
        } catch {
          printError(`Cannot read file: ${flags["body-file"]}`);
          return;
        }
      }

      if (!to || !subject) {
        printError("--to and --subject required");
        return;
      }

      const path = resolvePath();
      const projectResult = await apiRequest<Project>("POST", "/api/project/ensure", { human_key: path });
      if (!projectResult.ok) {
        printError(projectResult.error.message);
        return;
      }

      // Get sender (first agent in project for now, or require explicit)
      const agentsResult = await apiRequest<Agent[]>("GET", "/api/agents", undefined, { project: projectResult.value.slug });
      if (!agentsResult.ok || agentsResult.value.length === 0) {
        printError("No agents registered. Run: am agent register");
        return;
      }
      const sender = agentsResult.value[0].name;

      const result = await apiRequest<Message>("POST", "/api/message/send", {
        project_slug: projectResult.value.slug,
        sender,
        to,
        cc,
        subject,
        body_md: body || "",
        thread_id: flags.thread as string | undefined,
        importance: flags.urgent ? "urgent" : "normal",
        ack_required: !!flags.ack,
      });

      if (result.ok) {
        printSuccess(`Message sent (ID: ${result.value.id})`);
        console.log(`To: ${to.join(", ")}`);
        console.log(`Subject: ${subject}`);
        if (flags.thread) console.log(`Thread: ${flags.thread}`);
      } else {
        printError(result.error.message);
      }
      break;
    }

    case "inbox": {
      if (!await requireServer()) return;

      const path = resolvePath();
      const projectResult = await apiRequest<Project>("POST", "/api/project/ensure", { human_key: path });
      if (!projectResult.ok) {
        printError(projectResult.error.message);
        return;
      }

      const agentsResult = await apiRequest<Agent[]>("GET", "/api/agents", undefined, { project: projectResult.value.slug });
      if (!agentsResult.ok || agentsResult.value.length === 0) {
        printError("No agents registered. Run: am agent register");
        return;
      }
      const agent = agentsResult.value[0].name;

      const result = await apiRequest<InboxMessage[]>("GET", "/api/inbox", undefined, {
        project: projectResult.value.slug,
        agent,
        limit: (flags.limit as string) || "20",
        urgent: flags.urgent ? "true" : undefined,
        unread: flags.unread ? "true" : undefined,
        since: flags.since as string | undefined,
      });

      if (result.ok) {
        if (result.value.length === 0) {
          console.log("(no messages)");
          return;
        }
        for (const msg of result.value) {
          const read = msg.read_ts ? " " : "*";
          const ack = msg.ack_required && !msg.ack_ts ? "[ACK]" : "";
          const imp = msg.importance === "urgent" ? "[!]" : msg.importance === "high" ? "[H]" : "";
          console.log(`${read} #${msg.id} ${imp}${ack} ${msg.sender_name}: ${truncate(msg.subject, 50)} (${formatTime(msg.created_ts)})`);
        }
      } else {
        printError(result.error.message);
      }
      break;
    }

    case "outbox": {
      if (!await requireServer()) return;

      const path = resolvePath();
      const projectResult = await apiRequest<Project>("POST", "/api/project/ensure", { human_key: path });
      if (!projectResult.ok) {
        printError(projectResult.error.message);
        return;
      }

      const agentsResult = await apiRequest<Agent[]>("GET", "/api/agents", undefined, { project: projectResult.value.slug });
      if (!agentsResult.ok || agentsResult.value.length === 0) {
        printError("No agents registered");
        return;
      }
      const agent = agentsResult.value[0].name;

      const result = await apiRequest<MessageWithSender[]>("GET", "/api/outbox", undefined, {
        project: projectResult.value.slug,
        agent,
        limit: (flags.limit as string) || "20",
      });

      if (result.ok) {
        if (result.value.length === 0) {
          console.log("(no messages)");
          return;
        }
        for (const msg of result.value) {
          console.log(`#${msg.id} → ${msg.to_agents}: ${truncate(msg.subject, 50)} (${formatTime(msg.created_ts)})`);
        }
      } else {
        printError(result.error.message);
      }
      break;
    }

    case "read": {
      if (!await requireServer()) return;

      const messageId = positional[0];
      if (!messageId) {
        printError("Message ID required");
        return;
      }

      // Get message
      const msgResult = await apiRequest<MessageWithSender>("GET", `/api/message/${messageId}`);
      if (!msgResult.ok) {
        printError(msgResult.error.message);
        return;
      }

      // Mark as read
      const path = resolvePath();
      const projectResult = await apiRequest<Project>("POST", "/api/project/ensure", { human_key: path });
      if (!projectResult.ok) {
        printError(projectResult.error.message);
        return;
      }

      const agentsResult = await apiRequest<Agent[]>("GET", "/api/agents", undefined, { project: projectResult.value.slug });
      if (agentsResult.ok && agentsResult.value.length > 0) {
        await apiRequest("POST", `/api/message/${messageId}/read`, {
          project: projectResult.value.slug,
          agent: agentsResult.value[0].name,
        });
      }

      const msg = msgResult.value;
      console.log(`From: ${msg.sender_name}`);
      console.log(`To: ${msg.to_agents}`);
      if (msg.cc_agents) console.log(`CC: ${msg.cc_agents}`);
      console.log(`Subject: ${msg.subject}`);
      console.log(`Date: ${msg.created_ts}`);
      if (msg.thread_id) console.log(`Thread: ${msg.thread_id}`);
      console.log(`---`);
      console.log(msg.body_md);
      break;
    }

    case "ack": {
      if (!await requireServer()) return;

      const messageId = positional[0];
      if (!messageId) {
        printError("Message ID required");
        return;
      }

      const path = resolvePath();
      const projectResult = await apiRequest<Project>("POST", "/api/project/ensure", { human_key: path });
      if (!projectResult.ok) {
        printError(projectResult.error.message);
        return;
      }

      const agentsResult = await apiRequest<Agent[]>("GET", "/api/agents", undefined, { project: projectResult.value.slug });
      if (!agentsResult.ok || agentsResult.value.length === 0) {
        printError("No agents registered");
        return;
      }

      const result = await apiRequest<{ acknowledged: boolean }>("POST", `/api/message/${messageId}/ack`, {
        project: projectResult.value.slug,
        agent: agentsResult.value[0].name,
      });

      if (result.ok) {
        printSuccess(`Message #${messageId} acknowledged`);
      } else {
        printError(result.error.message);
      }
      break;
    }

    // --- Reservations ---
    case "reserve": {
      if (!await requireServer()) return;

      const pattern = positional[0];
      if (!pattern) {
        printError("Pattern required");
        return;
      }

      const path = resolvePath();
      const projectResult = await apiRequest<Project>("POST", "/api/project/ensure", { human_key: path });
      if (!projectResult.ok) {
        printError(projectResult.error.message);
        return;
      }

      const agentsResult = await apiRequest<Agent[]>("GET", "/api/agents", undefined, { project: projectResult.value.slug });
      if (!agentsResult.ok || agentsResult.value.length === 0) {
        printError("No agents registered. Run: am agent register");
        return;
      }

      const result = await apiRequest<ReservationResult>("POST", "/api/reservation/create", {
        project_slug: projectResult.value.slug,
        agent: agentsResult.value[0].name,
        path_pattern: pattern,
        ttl_seconds: flags.ttl ? parseInt(flags.ttl as string) : undefined,
        exclusive: !flags.shared,
        reason: flags.reason as string | undefined,
      });

      if (result.ok) {
        printSuccess(`Reserved: ${pattern}`);
        if (result.value.conflicts.length > 0) {
          console.log("\nConflicts:");
          for (const c of result.value.conflicts) {
            console.log(`  ${c.agent_name}: ${c.path_pattern} (expires: ${formatTime(c.expires_ts)})`);
          }
        }
      } else {
        printError(result.error.message);
      }
      break;
    }

    case "release": {
      if (!await requireServer()) return;

      const pattern = positional[0];

      const path = resolvePath();
      const projectResult = await apiRequest<Project>("POST", "/api/project/ensure", { human_key: path });
      if (!projectResult.ok) {
        printError(projectResult.error.message);
        return;
      }

      const agentsResult = await apiRequest<Agent[]>("GET", "/api/agents", undefined, { project: projectResult.value.slug });
      if (!agentsResult.ok || agentsResult.value.length === 0) {
        printError("No agents registered");
        return;
      }

      const result = await apiRequest<{ released: number }>("POST", "/api/reservation/release", {
        project_slug: projectResult.value.slug,
        agent: agentsResult.value[0].name,
        pattern: pattern,
        all: !!flags.all || !pattern,
      });

      if (result.ok) {
        printSuccess(`Released ${result.value.released} reservation(s)`);
      } else {
        printError(result.error.message);
      }
      break;
    }

    case "reservations": {
      if (!await requireServer()) return;

      const path = resolvePath();
      const projectResult = await apiRequest<Project>("POST", "/api/project/ensure", { human_key: path });
      if (!projectResult.ok) {
        printError(projectResult.error.message);
        return;
      }

      const result = await apiRequest<ReservationWithAgent[]>("GET", "/api/reservations", undefined, {
        project: projectResult.value.slug,
        active: flags.active ? "true" : undefined,
      });

      if (result.ok) {
        printTable(result.value, [
          { key: "id", label: "ID", width: 6 },
          { key: "agent_name", label: "Agent", width: 15 },
          { key: "path_pattern", label: "Pattern", width: 30 },
          { key: "reason", label: "Reason", width: 15 },
          { key: "expires_ts", label: "Expires", width: 20 },
        ]);
      } else {
        printError(result.error.message);
      }
      break;
    }

    // --- Search ---
    case "search": {
      if (!await requireServer()) return;

      const query = positional[0];
      if (!query) {
        printError("Search query required");
        return;
      }

      const path = resolvePath();
      const projectResult = await apiRequest<Project>("POST", "/api/project/ensure", { human_key: path });
      if (!projectResult.ok) {
        printError(projectResult.error.message);
        return;
      }

      const result = await apiRequest<MessageWithSender[]>("GET", "/api/search", undefined, {
        project: projectResult.value.slug,
        q: query,
        limit: (flags.limit as string) || "20",
      });

      if (result.ok) {
        if (result.value.length === 0) {
          console.log("(no results)");
          return;
        }
        for (const msg of result.value) {
          console.log(`#${msg.id} ${msg.sender_name}: ${truncate(msg.subject, 50)} (${formatTime(msg.created_ts)})`);
        }
      } else {
        printError(result.error.message);
      }
      break;
    }

    // --- Config ---
    case "config": {
      if (subcommand === "set") {
        const key = positional[1] as "port" | "retention_days";
        const value = positional[2];
        if (!key || !value) {
          printError("Usage: am config set <key> <value>");
          return;
        }
        if (key !== "port" && key !== "retention_days") {
          printError("Valid keys: port, retention_days");
          return;
        }
        const config = updateConfig(key, parseInt(value));
        printSuccess(`${key} = ${config[key]}`);
      } else {
        const config = loadConfig();
        console.log(`Config file: ${paths.config}`);
        console.log(`port: ${config.port}`);
        console.log(`retention_days: ${config.retention_days}`);
      }
      break;
    }

    // --- Prune ---
    case "prune": {
      if (!await requireServer()) return;

      const result = await apiRequest<{ messages: number; reservations: number }>("POST", "/api/prune");
      if (result.ok) {
        console.log(`Deleted: ${result.value.messages} messages, ${result.value.reservations} reservations`);
      } else {
        printError(result.error.message);
      }
      break;
    }

    default:
      printError(`Unknown command: ${command}`);
      usage();
  }
}

main().catch(e => {
  printError(e.message);
  process.exit(1);
});
