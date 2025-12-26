import { getDb } from "../db.js";
import type { Project, Result, ApiError } from "../types.js";
import { Ok, Err } from "../types.js";
import { projectSlug } from "../utils/slug.js";

/**
 * Ensure a project exists, creating it if necessary.
 */
export function ensureProject(humanKey: string): Result<Project, ApiError> {
  const db = getDb();
  const slug = projectSlug(humanKey);

  // Check if exists
  const existing = db.query<Project, [string]>(
    "SELECT * FROM projects WHERE human_key = ? OR slug = ?"
  ).get(humanKey, slug);

  if (existing) {
    return Ok(existing);
  }

  // Create new project
  try {
    db.run(
      "INSERT INTO projects (slug, human_key) VALUES (?, ?)",
      [slug, humanKey]
    );

    const created = db.query<Project, [string]>(
      "SELECT * FROM projects WHERE slug = ?"
    ).get(slug);

    if (!created) {
      return Err({
        type: "PROJECT_CREATE_FAILED",
        message: "Failed to create project",
        recoverable: true,
      });
    }

    return Ok(created);
  } catch (error) {
    return Err({
      type: "PROJECT_CREATE_FAILED",
      message: error instanceof Error ? error.message : "Unknown error",
      recoverable: false,
    });
  }
}

/**
 * Get a project by slug or human_key.
 */
export function getProject(slugOrKey: string): Result<Project, ApiError> {
  const db = getDb();

  const project = db.query<Project, [string, string]>(
    "SELECT * FROM projects WHERE slug = ? OR human_key = ?"
  ).get(slugOrKey, slugOrKey);

  if (!project) {
    // Try to find similar projects for suggestion
    const allProjects = db.query<{ slug: string; human_key: string }, []>(
      "SELECT slug, human_key FROM projects"
    ).all();

    const suggestions = allProjects
      .filter(p => 
        p.slug.includes(slugOrKey.toLowerCase()) || 
        p.human_key.includes(slugOrKey)
      )
      .slice(0, 3)
      .map(p => p.slug);

    return Err({
      type: "PROJECT_NOT_FOUND",
      message: `Project not found: ${slugOrKey}`,
      recoverable: true,
      data: suggestions.length > 0 ? { suggestions } : undefined,
    });
  }

  return Ok(project);
}

/**
 * List all projects.
 */
export function listProjects(): Project[] {
  const db = getDb();
  return db.query<Project, []>(
    "SELECT * FROM projects ORDER BY created_at DESC"
  ).all();
}

/**
 * Get project by ID.
 */
export function getProjectById(id: number): Project | null {
  const db = getDb();
  return db.query<Project, [number]>(
    "SELECT * FROM projects WHERE id = ?"
  ).get(id) ?? null;
}

/**
 * Delete a project and all related data.
 */
export function deleteProject(slugOrKey: string): Result<boolean, ApiError> {
  const projectResult = getProject(slugOrKey);
  if (!projectResult.ok) return projectResult;

  const db = getDb();
  try {
    db.run("DELETE FROM projects WHERE id = ?", [projectResult.value.id]);
    return Ok(true);
  } catch (error) {
    return Err({
      type: "PROJECT_DELETE_FAILED",
      message: error instanceof Error ? error.message : "Unknown error",
      recoverable: false,
    });
  }
}
