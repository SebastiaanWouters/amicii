import { Database } from "bun:sqlite";
import { paths, ensureDir } from "./config.js";

let db: Database | null = null;

/**
 * Get or create database connection.
 */
export function getDb(): Database {
  if (db) return db;

  ensureDir();
  db = new Database(paths.db, { create: true });

  // Enable WAL mode and set pragmas for performance
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA synchronous = NORMAL");
  db.run("PRAGMA cache_size = -64000"); // 64MB cache

  ensureSchema(db);
  return db;
}

/**
 * Close database connection.
 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Create database schema if not exists.
 */
function ensureSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      human_key TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      program TEXT NOT NULL,
      model TEXT NOT NULL,
      task_description TEXT DEFAULT '',
      inception_ts TEXT NOT NULL DEFAULT (datetime('now')),
      last_active_ts TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, name)
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_agents_project ON agents(project_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_agents_project_name ON agents(project_id, name)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      sender_id INTEGER NOT NULL REFERENCES agents(id),
      thread_id TEXT,
      subject TEXT NOT NULL,
      body_md TEXT NOT NULL,
      to_agents TEXT NOT NULL,
      cc_agents TEXT DEFAULT '',
      importance TEXT NOT NULL DEFAULT 'normal' CHECK(importance IN ('low','normal','high','urgent')),
      ack_required INTEGER NOT NULL DEFAULT 0,
      created_ts TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_project_created ON messages(project_id, created_ts DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id) WHERE thread_id IS NOT NULL`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_ts)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS message_recipients (
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('to','cc','bcc')),
      read_ts TEXT,
      ack_ts TEXT,
      PRIMARY KEY (message_id, agent_id)
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_recipients_agent ON message_recipients(agent_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_recipients_unread ON message_recipients(agent_id) WHERE read_ts IS NULL`);

  db.run(`
    CREATE TABLE IF NOT EXISTS file_reservations (
      id INTEGER PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      path_pattern TEXT NOT NULL,
      exclusive INTEGER NOT NULL DEFAULT 1,
      reason TEXT DEFAULT '',
      created_ts TEXT NOT NULL DEFAULT (datetime('now')),
      expires_ts TEXT NOT NULL,
      released_ts TEXT
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_reservations_active 
    ON file_reservations(project_id, expires_ts) WHERE released_ts IS NULL
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_reservations_agent ON file_reservations(agent_id)`);

  // FTS5 for full-text search
  // Check if FTS table exists first
  const ftsExists = db.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='fts_messages'"
  ).get();

  if (!ftsExists) {
    db.run(`
      CREATE VIRTUAL TABLE fts_messages USING fts5(
        subject, body_md,
        content='messages',
        content_rowid='id'
      )
    `);

    // Triggers to keep FTS in sync
    db.run(`
      CREATE TRIGGER IF NOT EXISTS msg_fts_insert AFTER INSERT ON messages BEGIN
        INSERT INTO fts_messages(rowid, subject, body_md) VALUES (new.id, new.subject, new.body_md);
      END
    `);

    db.run(`
      CREATE TRIGGER IF NOT EXISTS msg_fts_delete AFTER DELETE ON messages BEGIN
        INSERT INTO fts_messages(fts_messages, rowid, subject, body_md) 
        VALUES('delete', old.id, old.subject, old.body_md);
      END
    `);

    db.run(`
      CREATE TRIGGER IF NOT EXISTS msg_fts_update AFTER UPDATE ON messages BEGIN
        INSERT INTO fts_messages(fts_messages, rowid, subject, body_md) 
        VALUES('delete', old.id, old.subject, old.body_md);
        INSERT INTO fts_messages(rowid, subject, body_md) VALUES (new.id, new.subject, new.body_md);
      END
    `);
  }
}

/**
 * Run retention cleanup - delete old messages and reservations.
 */
export function runRetention(retentionDays: number): { messages: number; reservations: number } {
  const database = getDb();
  const cutoff = `-${retentionDays} days`;

  // First, mark expired reservations as released
  database.run(`
    UPDATE file_reservations 
    SET released_ts = expires_ts 
    WHERE released_ts IS NULL AND expires_ts < datetime('now')
  `);

  // Delete old messages (this cascades to message_recipients and updates FTS via triggers)
  const msgResult = database.run(`
    DELETE FROM messages WHERE created_ts < datetime('now', ?)
  `, [cutoff]);

  // Delete old released/expired reservations
  const resResult = database.run(`
    DELETE FROM file_reservations 
    WHERE (released_ts IS NOT NULL OR expires_ts < datetime('now'))
      AND created_ts < datetime('now', ?)
  `, [cutoff]);

  return {
    messages: msgResult.changes,
    reservations: resResult.changes,
  };
}

/**
 * Get database stats.
 */
export function getStats(): {
  projects: number;
  agents: number;
  messages: number;
  reservations_active: number;
} {
  const database = getDb();

  const projects = database.query("SELECT COUNT(*) as count FROM projects").get() as { count: number };
  const agents = database.query("SELECT COUNT(*) as count FROM agents").get() as { count: number };
  const messages = database.query("SELECT COUNT(*) as count FROM messages").get() as { count: number };
  const reservations = database.query(`
    SELECT COUNT(*) as count FROM file_reservations 
    WHERE released_ts IS NULL AND expires_ts > datetime('now')
  `).get() as { count: number };

  return {
    projects: projects.count,
    agents: agents.count,
    messages: messages.count,
    reservations_active: reservations.count,
  };
}
