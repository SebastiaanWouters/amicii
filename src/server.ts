import { loadConfig, paths, writePid, removePid, getConfigValue } from "./config.js";
import { getDb, closeDb, runRetention, getStats } from "./db.js";
import { ensureProject, getProject, listProjects } from "./handlers/project.js";
import { registerAgent, getAgent, listAgents } from "./handlers/agent.js";
import { sendMessage, fetchInbox, fetchOutbox, getMessage, markRead, acknowledge } from "./handlers/message.js";
import { createReservation, releaseReservations, listReservations } from "./handlers/reservation.js";
import { searchMessages } from "./handlers/search.js";
import type { Result, ApiError, ServerStatus } from "./types.js";

const VERSION = "0.1.0";
let startTime = Date.now();
let retentionInterval: ReturnType<typeof setInterval> | null = null;

/**
 * JSON response helper.
 */
function json<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Error response helper.
 */
function errorResponse(error: ApiError, status = 400): Response {
  return json({ error }, status);
}

/**
 * Handle Result type responses.
 */
function resultResponse<T>(result: Result<T, ApiError>): Response {
  if (result.ok) {
    return json(result.value);
  }
  const status = result.error.type.includes("NOT_FOUND") ? 404 : 400;
  return errorResponse(result.error, status);
}

/**
 * Parse JSON body safely.
 */
async function parseBody<T>(req: Request): Promise<T | null> {
  try {
    return await req.json() as T;
  } catch {
    return null;
  }
}

/**
 * Get query params as object.
 */
function getQuery(req: Request): URLSearchParams {
  return new URL(req.url).searchParams;
}

/**
 * Route handler.
 */
async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // Health check
  if (path === "/health" && method === "GET") {
    return json({ status: "ok", version: VERSION });
  }

  // Status with stats
  if (path === "/api/status" && method === "GET") {
    const stats = getStats();
    const config = loadConfig();
    const status: ServerStatus = {
      status: "ok",
      version: VERSION,
      uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
      projects_count: stats.projects,
      agents_count: stats.agents,
      messages_count: stats.messages,
      reservations_active: stats.reservations_active,
      retention_days: config.retention_days,
    };
    return json(status);
  }

  // Manual prune
  if (path === "/api/prune" && method === "POST") {
    const config = loadConfig();
    const result = runRetention(config.retention_days);
    return json(result);
  }

  // --- Projects ---
  if (path === "/api/project/ensure" && method === "POST") {
    const body = await parseBody<{ human_key: string }>(req);
    if (!body?.human_key) {
      return errorResponse({ type: "INVALID_INPUT", message: "human_key required", recoverable: true });
    }
    return resultResponse(ensureProject(body.human_key));
  }

  if (path === "/api/projects" && method === "GET") {
    return json(listProjects());
  }

  if (path.startsWith("/api/project/") && method === "GET") {
    const slug = path.slice("/api/project/".length);
    return resultResponse(getProject(slug));
  }

  // --- Agents ---
  if (path === "/api/agent/register" && method === "POST") {
    const body = await parseBody<{
      project_slug: string;
      name?: string;
      program: string;
      model: string;
      task_description?: string;
    }>(req);
    if (!body?.project_slug || !body?.program || !body?.model) {
      return errorResponse({ type: "INVALID_INPUT", message: "project_slug, program, model required", recoverable: true });
    }
    return resultResponse(registerAgent({
      projectSlug: body.project_slug,
      name: body.name,
      program: body.program,
      model: body.model,
      taskDescription: body.task_description,
    }));
  }

  if (path === "/api/agents" && method === "GET") {
    const project = getQuery(req).get("project");
    if (!project) {
      return errorResponse({ type: "INVALID_INPUT", message: "project query param required", recoverable: true });
    }
    return resultResponse(listAgents(project));
  }

  if (path.match(/^\/api\/agent\/[^/]+\/[^/]+$/) && method === "GET") {
    const parts = path.split("/");
    const project = parts[3];
    const name = parts[4];
    return resultResponse(getAgent(project, name));
  }

  // --- Messages ---
  if (path === "/api/message/send" && method === "POST") {
    const body = await parseBody<{
      project_slug: string;
      sender: string;
      to: string[];
      cc?: string[];
      subject: string;
      body_md: string;
      thread_id?: string;
      importance?: "low" | "normal" | "high" | "urgent";
      ack_required?: boolean;
    }>(req);
    if (!body?.project_slug || !body?.sender || !body?.to || !body?.subject || body?.body_md === undefined) {
      return errorResponse({ type: "INVALID_INPUT", message: "project_slug, sender, to, subject, body_md required", recoverable: true });
    }
    return resultResponse(sendMessage({
      projectSlug: body.project_slug,
      sender: body.sender,
      to: body.to,
      cc: body.cc,
      subject: body.subject,
      bodyMd: body.body_md,
      threadId: body.thread_id,
      importance: body.importance,
      ackRequired: body.ack_required,
    }));
  }

  if (path === "/api/inbox" && method === "GET") {
    const q = getQuery(req);
    const project = q.get("project");
    const agent = q.get("agent");
    if (!project || !agent) {
      return errorResponse({ type: "INVALID_INPUT", message: "project and agent query params required", recoverable: true });
    }
    return resultResponse(fetchInbox({
      projectSlug: project,
      agentName: agent,
      limit: q.get("limit") ? parseInt(q.get("limit")!) : undefined,
      urgent: q.get("urgent") === "true",
      unread: q.get("unread") === "true",
      since: q.get("since") ?? undefined,
    }));
  }

  if (path === "/api/outbox" && method === "GET") {
    const q = getQuery(req);
    const project = q.get("project");
    const agent = q.get("agent");
    if (!project || !agent) {
      return errorResponse({ type: "INVALID_INPUT", message: "project and agent query params required", recoverable: true });
    }
    return resultResponse(fetchOutbox({
      projectSlug: project,
      agentName: agent,
      limit: q.get("limit") ? parseInt(q.get("limit")!) : undefined,
    }));
  }

  if (path.match(/^\/api\/message\/\d+$/) && method === "GET") {
    const id = parseInt(path.split("/").pop()!);
    return resultResponse(getMessage(id));
  }

  if (path.match(/^\/api\/message\/\d+\/read$/) && method === "POST") {
    const id = parseInt(path.split("/")[3]);
    const body = await parseBody<{ agent: string; project: string }>(req);
    if (!body?.agent || !body?.project) {
      return errorResponse({ type: "INVALID_INPUT", message: "agent and project required", recoverable: true });
    }
    return resultResponse(markRead(body.project, body.agent, id));
  }

  if (path.match(/^\/api\/message\/\d+\/ack$/) && method === "POST") {
    const id = parseInt(path.split("/")[3]);
    const body = await parseBody<{ agent: string; project: string }>(req);
    if (!body?.agent || !body?.project) {
      return errorResponse({ type: "INVALID_INPUT", message: "agent and project required", recoverable: true });
    }
    return resultResponse(acknowledge(body.project, body.agent, id));
  }

  // --- Reservations ---
  if (path === "/api/reservation/create" && method === "POST") {
    const body = await parseBody<{
      project_slug: string;
      agent: string;
      path_pattern: string;
      ttl_seconds?: number;
      exclusive?: boolean;
      reason?: string;
    }>(req);
    if (!body?.project_slug || !body?.agent || !body?.path_pattern) {
      return errorResponse({ type: "INVALID_INPUT", message: "project_slug, agent, path_pattern required", recoverable: true });
    }
    return resultResponse(createReservation({
      projectSlug: body.project_slug,
      agentName: body.agent,
      pathPattern: body.path_pattern,
      ttlSeconds: body.ttl_seconds,
      exclusive: body.exclusive,
      reason: body.reason,
    }));
  }

  if (path === "/api/reservation/release" && method === "POST") {
    const body = await parseBody<{
      project_slug: string;
      agent: string;
      pattern?: string;
      all?: boolean;
    }>(req);
    if (!body?.project_slug || !body?.agent) {
      return errorResponse({ type: "INVALID_INPUT", message: "project_slug, agent required", recoverable: true });
    }
    return resultResponse(releaseReservations({
      projectSlug: body.project_slug,
      agentName: body.agent,
      pattern: body.pattern,
      all: body.all,
    }));
  }

  if (path === "/api/reservations" && method === "GET") {
    const q = getQuery(req);
    const project = q.get("project");
    if (!project) {
      return errorResponse({ type: "INVALID_INPUT", message: "project query param required", recoverable: true });
    }
    return resultResponse(listReservations({
      projectSlug: project,
      active: q.get("active") === "true",
    }));
  }

  // --- Search ---
  if (path === "/api/search" && method === "GET") {
    const q = getQuery(req);
    const project = q.get("project");
    const query = q.get("q");
    if (!project || !query) {
      return errorResponse({ type: "INVALID_INPUT", message: "project and q query params required", recoverable: true });
    }
    return resultResponse(searchMessages({
      projectSlug: project,
      query: query,
      limit: q.get("limit") ? parseInt(q.get("limit")!) : undefined,
    }));
  }

  // 404
  return json({ error: { type: "NOT_FOUND", message: `Route not found: ${method} ${path}` } }, 404);
}

/**
 * Start the HTTP server.
 */
export function startServer(port: number): void {
  // Initialize database
  getDb();

  // Start retention cleanup interval (every 6 hours)
  const config = loadConfig();
  retentionInterval = setInterval(() => {
    try {
      const result = runRetention(config.retention_days);
      if (result.messages > 0 || result.reservations > 0) {
        console.log(`Retention cleanup: ${result.messages} messages, ${result.reservations} reservations deleted`);
      }
    } catch (e) {
      console.error("Retention cleanup error:", e);
    }
  }, 6 * 60 * 60 * 1000);

  // Run initial cleanup
  runRetention(config.retention_days);

  startTime = Date.now();

  const server = Bun.serve({
    port,
    fetch: handleRequest,
  });

  writePid(process.pid);

  console.log(`Amicii server running on http://localhost:${port}`);
  console.log(`PID: ${process.pid}`);
  console.log(`Database: ${paths.db}`);
  console.log(`Config: ${paths.config}`);

  // Handle shutdown
  const shutdown = () => {
    console.log("\nShutting down...");
    if (retentionInterval) {
      clearInterval(retentionInterval);
    }
    closeDb();
    removePid();
    server.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}



/**
 * Stop the server by PID.
 */
export function stopServer(): void {
  const pid = readPidFile();
  if (!pid) {
    console.log("No server PID file found");
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    console.log(`Sent SIGTERM to server (PID: ${pid})`);
    removePid();
  } catch (e) {
    console.error(`Failed to stop server: ${e}`);
    removePid(); // Clean up stale PID file
  }
}

function readPidFile(): number | null {
  try {
    const content = require("fs").readFileSync(paths.pid, "utf-8").trim();
    return parseInt(content, 10) || null;
  } catch {
    return null;
  }
}
