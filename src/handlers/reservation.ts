import { getDb } from "../db.js";
import type { FileReservation, ReservationWithAgent, ReservationConflict, ReservationResult, Result, ApiError } from "../types.js";
import { Ok, Err } from "../types.js";
import { getProject } from "./project.js";
import { getAgent } from "./agent.js";

export interface CreateReservationInput {
  projectSlug: string;
  agentName: string;
  pathPattern: string;
  ttlSeconds?: number;
  exclusive?: boolean;
  reason?: string;
}

/**
 * Check if two path patterns might overlap.
 * Simple heuristic: check prefix match or glob overlap.
 */
function patternsOverlap(pattern1: string, pattern2: string): boolean {
  // Normalize patterns
  const p1 = pattern1.replace(/\*\*\//g, "").replace(/\*/g, "");
  const p2 = pattern2.replace(/\*\*\//g, "").replace(/\*/g, "");

  // Check if one is prefix of other
  if (p1.startsWith(p2) || p2.startsWith(p1)) return true;

  // Check directory overlap
  const dir1 = p1.split("/").slice(0, -1).join("/");
  const dir2 = p2.split("/").slice(0, -1).join("/");
  if (dir1 && dir2 && (dir1.startsWith(dir2) || dir2.startsWith(dir1))) return true;

  return pattern1 === pattern2;
}

/**
 * Create a file reservation.
 */
export function createReservation(input: CreateReservationInput): Result<ReservationResult, ApiError> {
  const db = getDb();

  // Get project and agent
  const projectResult = getProject(input.projectSlug);
  if (!projectResult.ok) return projectResult;
  const project = projectResult.value;

  const agentResult = getAgent(input.projectSlug, input.agentName);
  if (!agentResult.ok) return agentResult;
  const agent = agentResult.value;

  const ttlSeconds = input.ttlSeconds ?? 3600; // Default 1 hour
  const exclusive = input.exclusive ?? true;

  // Check for conflicts with active exclusive reservations
  const activeReservations = db.query<ReservationWithAgent, [number, number]>(`
    SELECT fr.*, a.name as agent_name
    FROM file_reservations fr
    JOIN agents a ON fr.agent_id = a.id
    WHERE fr.project_id = ? 
      AND fr.released_ts IS NULL 
      AND fr.expires_ts > datetime('now')
      AND fr.exclusive = 1
      AND fr.agent_id != ?
  `).all(project.id, agent.id);
  const conflicts: ReservationConflict[] = [];
  for (const res of activeReservations) {
    if (res.agent_id !== agent.id && patternsOverlap(input.pathPattern, res.path_pattern)) {
      conflicts.push({
        id: res.id,
        agent_name: res.agent_name,
        path_pattern: res.path_pattern,
        expires_ts: res.expires_ts,
        reason: res.reason,
      });
    }
  }

  // Create the reservation anyway (advisory), but report conflicts
  try {
    const expiresTs = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    db.run(`
      INSERT INTO file_reservations (project_id, agent_id, path_pattern, exclusive, reason, expires_ts)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [project.id, agent.id, input.pathPattern, exclusive ? 1 : 0, input.reason ?? "", expiresTs]);

    const reservationId = db.query<{ id: number }, []>(
      "SELECT last_insert_rowid() as id"
    ).get()!.id;

    const reservation = db.query<FileReservation, [number]>(
      "SELECT * FROM file_reservations WHERE id = ?"
    ).get(reservationId);

    return Ok({
      granted: [reservation!],
      conflicts,
    });
  } catch (error) {
    return Err({
      type: "RESERVATION_CREATE_FAILED",
      message: error instanceof Error ? error.message : "Unknown error",
      recoverable: false,
    });
  }
}

export interface ReleaseReservationInput {
  projectSlug: string;
  agentName: string;
  pattern?: string;
  all?: boolean;
}

/**
 * Release file reservations.
 */
export function releaseReservations(input: ReleaseReservationInput): Result<{ released: number; releasedAt: string }, ApiError> {
  const db = getDb();

  const projectResult = getProject(input.projectSlug);
  if (!projectResult.ok) return projectResult;
  const project = projectResult.value;

  const agentResult = getAgent(input.projectSlug, input.agentName);
  if (!agentResult.ok) return agentResult;
  const agent = agentResult.value;

  const now = new Date().toISOString();

  let result;
  if (input.all) {
    result = db.run(`
      UPDATE file_reservations 
      SET released_ts = ?
      WHERE project_id = ? AND agent_id = ? AND released_ts IS NULL
    `, [now, project.id, agent.id]);
  } else if (input.pattern) {
    result = db.run(`
      UPDATE file_reservations 
      SET released_ts = ?
      WHERE project_id = ? AND agent_id = ? AND path_pattern = ? AND released_ts IS NULL
    `, [now, project.id, agent.id, input.pattern]);
  } else {
    return Err({
      type: "INVALID_INPUT",
      message: "Must specify pattern or all=true",
      recoverable: true,
    });
  }

  return Ok({
    released: result.changes,
    releasedAt: now,
  });
}

export interface ListReservationsQuery {
  projectSlug: string;
  active?: boolean;
}

/**
 * List reservations for a project.
 */
export function listReservations(query: ListReservationsQuery): Result<ReservationWithAgent[], ApiError> {
  const db = getDb();

  const projectResult = getProject(query.projectSlug);
  if (!projectResult.ok) return projectResult;
  const project = projectResult.value;

  let sql = `
    SELECT fr.*, a.name as agent_name
    FROM file_reservations fr
    JOIN agents a ON fr.agent_id = a.id
    WHERE fr.project_id = ?
  `;
  const params: (number | string)[] = [project.id];

  if (query.active) {
    sql += " AND fr.released_ts IS NULL AND fr.expires_ts > datetime('now')";
  }

  sql += " ORDER BY fr.created_ts DESC";

  const reservations = db.query<ReservationWithAgent, (number | string)[]>(sql).all(...params);

  return Ok(reservations);
}

/**
 * Get active reservations for an agent.
 */
export function getAgentReservations(projectSlug: string, agentName: string): Result<FileReservation[], ApiError> {
  const db = getDb();

  const projectResult = getProject(projectSlug);
  if (!projectResult.ok) return projectResult;
  const project = projectResult.value;

  const agentResult = getAgent(projectSlug, agentName);
  if (!agentResult.ok) return agentResult;
  const agent = agentResult.value;

  const reservations = db.query<FileReservation, [number, number]>(`
    SELECT * FROM file_reservations 
    WHERE project_id = ? AND agent_id = ? 
      AND released_ts IS NULL AND expires_ts > datetime('now')
    ORDER BY created_ts DESC
  `).all(project.id, agent.id);

  return Ok(reservations);
}
