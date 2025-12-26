import { getDb } from "../db.js";
import type { Agent, Result, ApiError } from "../types.js";
import { Ok, Err } from "../types.js";
import { getProject } from "./project.js";
import { generateUniqueName, isValidName } from "../utils/names.js";

export interface RegisterAgentInput {
  projectSlug: string;
  name?: string;
  program: string;
  model: string;
  taskDescription?: string;
}

/**
 * Register or update an agent.
 */
export function registerAgent(input: RegisterAgentInput): Result<Agent, ApiError> {
  const db = getDb();

  // Get project
  const projectResult = getProject(input.projectSlug);
  if (!projectResult.ok) return projectResult;
  const project = projectResult.value;

  // Get existing agent names
  const existingAgents = db.query<{ name: string }, [number]>(
    "SELECT name FROM agents WHERE project_id = ?"
  ).all(project.id);
  const existingNames = new Set(existingAgents.map(a => a.name));

  // Generate or validate name
  let name: string;
  if (input.name) {
    if (isValidName(input.name)) {
      name = input.name;
    } else {
      // Use as hint for generation
      name = generateUniqueName(existingNames, input.name);
    }
  } else {
    name = generateUniqueName(existingNames);
  }

  // Check if agent already exists
  const existing = db.query<Agent, [number, string]>(
    "SELECT * FROM agents WHERE project_id = ? AND name = ?"
  ).get(project.id, name);

  if (existing) {
    // Update existing agent
    db.run(`
      UPDATE agents 
      SET program = ?, model = ?, task_description = ?, last_active_ts = datetime('now')
      WHERE id = ?
    `, [input.program, input.model, input.taskDescription ?? "", existing.id]);

    const updated = db.query<Agent, [number]>(
      "SELECT * FROM agents WHERE id = ?"
    ).get(existing.id);

    return Ok(updated!);
  }

  // Create new agent
  try {
    db.run(`
      INSERT INTO agents (project_id, name, program, model, task_description)
      VALUES (?, ?, ?, ?, ?)
    `, [project.id, name, input.program, input.model, input.taskDescription ?? ""]);

    const created = db.query<Agent, [number, string]>(
      "SELECT * FROM agents WHERE project_id = ? AND name = ?"
    ).get(project.id, name);

    if (!created) {
      return Err({
        type: "AGENT_CREATE_FAILED",
        message: "Failed to create agent",
        recoverable: true,
      });
    }

    return Ok(created);
  } catch (error) {
    return Err({
      type: "AGENT_CREATE_FAILED",
      message: error instanceof Error ? error.message : "Unknown error",
      recoverable: false,
    });
  }
}

/**
 * Get agent by name within a project.
 */
export function getAgent(projectSlug: string, agentName: string): Result<Agent, ApiError> {
  const db = getDb();

  const projectResult = getProject(projectSlug);
  if (!projectResult.ok) return projectResult;
  const project = projectResult.value;

  const agent = db.query<Agent, [number, string]>(
    "SELECT * FROM agents WHERE project_id = ? AND name = ?"
  ).get(project.id, agentName);

  if (!agent) {
    // Find similar names for suggestions
    const allAgents = db.query<{ name: string }, [number]>(
      "SELECT name FROM agents WHERE project_id = ?"
    ).all(project.id);

    const suggestions = allAgents
      .filter(a => a.name.toLowerCase().includes(agentName.toLowerCase()))
      .slice(0, 3)
      .map(a => a.name);

    return Err({
      type: "AGENT_NOT_FOUND",
      message: `Agent not found: ${agentName}`,
      recoverable: true,
      data: suggestions.length > 0 ? { suggestions } : undefined,
    });
  }

  // Update last_active_ts
  db.run(
    "UPDATE agents SET last_active_ts = datetime('now') WHERE id = ?",
    [agent.id]
  );

  return Ok(agent);
}

/**
 * List agents in a project.
 */
export function listAgents(projectSlug: string): Result<Agent[], ApiError> {
  const db = getDb();

  const projectResult = getProject(projectSlug);
  if (!projectResult.ok) return projectResult;
  const project = projectResult.value;

  const agents = db.query<Agent, [number]>(
    "SELECT * FROM agents WHERE project_id = ? ORDER BY last_active_ts DESC"
  ).all(project.id);

  return Ok(agents);
}

/**
 * Get agent by ID.
 */
export function getAgentById(id: number): Agent | null {
  const db = getDb();
  return db.query<Agent, [number]>(
    "SELECT * FROM agents WHERE id = ?"
  ).get(id) ?? null;
}
