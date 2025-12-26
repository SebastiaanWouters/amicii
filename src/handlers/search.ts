import { getDb } from "../db.js";
import type { MessageWithSender, Result, ApiError } from "../types.js";
import { Ok, Err } from "../types.js";
import { getProject } from "./project.js";

export interface SearchQuery {
  projectSlug: string;
  query: string;
  limit?: number;
}

/**
 * Search messages using FTS5.
 */
export function searchMessages(query: SearchQuery): Result<MessageWithSender[], ApiError> {
  const db = getDb();

  const projectResult = getProject(query.projectSlug);
  if (!projectResult.ok) return projectResult;
  const project = projectResult.value;

  const limit = query.limit ?? 20;

  // Escape FTS5 special characters and create search query
  const searchTerm = query.query
    .replace(/['"]/g, "") // Remove quotes
    .trim();

  if (!searchTerm) {
    return Ok([]);
  }

  try {
    // Use FTS5 MATCH with bm25 ranking
    const messages = db.query<MessageWithSender, [string, number, number]>(`
      SELECT m.*, a.name as sender_name, bm25(fts_messages) as rank
      FROM fts_messages fts
      JOIN messages m ON fts.rowid = m.id
      JOIN agents a ON m.sender_id = a.id
      WHERE fts_messages MATCH ? AND m.project_id = ?
      ORDER BY rank
      LIMIT ?
    `).all(searchTerm, project.id, limit);

    return Ok(messages);
  } catch (error) {
    // Fallback to LIKE search if FTS fails
    const likePattern = `%${searchTerm}%`;
    const messages = db.query<MessageWithSender, [number, string, string, number]>(`
      SELECT m.*, a.name as sender_name
      FROM messages m
      JOIN agents a ON m.sender_id = a.id
      WHERE m.project_id = ? AND (m.subject LIKE ? OR m.body_md LIKE ?)
      ORDER BY m.created_ts DESC
      LIMIT ?
    `).all(project.id, likePattern, likePattern, limit);

    return Ok(messages);
  }
}
