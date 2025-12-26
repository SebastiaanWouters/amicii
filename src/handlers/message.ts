import { getDb } from "../db.js";
import type { Message, MessageRecipient, InboxMessage, MessageWithSender, Result, ApiError } from "../types.js";
import { Ok, Err } from "../types.js";
import { getProject } from "./project.js";
import { getAgent, getAgentById } from "./agent.js";

export interface SendMessageInput {
  projectSlug: string;
  sender: string;
  to: string[];
  cc?: string[];
  subject: string;
  bodyMd: string;
  threadId?: string;
  importance?: "low" | "normal" | "high" | "urgent";
  ackRequired?: boolean;
}

/**
 * Send a message.
 */
export function sendMessage(input: SendMessageInput): Result<Message, ApiError> {
  const db = getDb();

  // Get project
  const projectResult = getProject(input.projectSlug);
  if (!projectResult.ok) return projectResult;
  const project = projectResult.value;

  // Get sender
  const senderResult = getAgent(input.projectSlug, input.sender);
  if (!senderResult.ok) return senderResult;
  const sender = senderResult.value;

  // Validate recipients exist
  const allRecipients = [...input.to, ...(input.cc ?? [])];
  const recipientAgents: { agent: { id: number; name: string }; kind: "to" | "cc" }[] = [];

  for (const recipientName of input.to) {
    if (recipientName.toLowerCase() === "all") {
      // Special case: send to all agents in project except sender
      const agents = db.query<{ id: number; name: string }, [number, number]>(
        "SELECT id, name FROM agents WHERE project_id = ? AND id != ?"
      ).all(project.id, sender.id);
      for (const agent of agents) {
        recipientAgents.push({ agent, kind: "to" });
      }
    } else {
      const recipientResult = getAgent(input.projectSlug, recipientName);
      if (!recipientResult.ok) return recipientResult;
      recipientAgents.push({ agent: recipientResult.value, kind: "to" });
    }
  }

  for (const ccName of input.cc ?? []) {
    const recipientResult = getAgent(input.projectSlug, ccName);
    if (!recipientResult.ok) return recipientResult;
    recipientAgents.push({ agent: recipientResult.value, kind: "cc" });
  }

  if (recipientAgents.length === 0) {
    return Err({
      type: "NO_RECIPIENTS",
      message: "No recipients specified or found",
      recoverable: true,
    });
  }

  // Create message
  try {
    const toAgents = recipientAgents
      .filter(r => r.kind === "to")
      .map(r => r.agent.name)
      .join(",");
    const ccAgents = recipientAgents
      .filter(r => r.kind === "cc")
      .map(r => r.agent.name)
      .join(",");

    db.run(`
      INSERT INTO messages (project_id, sender_id, thread_id, subject, body_md, to_agents, cc_agents, importance, ack_required)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      project.id,
      sender.id,
      input.threadId ?? null,
      input.subject,
      input.bodyMd,
      toAgents,
      ccAgents,
      input.importance ?? "normal",
      input.ackRequired ? 1 : 0,
    ]);

    const messageId = db.query<{ id: number }, []>(
      "SELECT last_insert_rowid() as id"
    ).get()!.id;

    // Create recipient records
    for (const recipient of recipientAgents) {
      db.run(`
        INSERT INTO message_recipients (message_id, agent_id, kind)
        VALUES (?, ?, ?)
      `, [messageId, recipient.agent.id, recipient.kind]);
    }

    const message = db.query<Message, [number]>(
      "SELECT * FROM messages WHERE id = ?"
    ).get(messageId);

    return Ok(message!);
  } catch (error) {
    return Err({
      type: "MESSAGE_SEND_FAILED",
      message: error instanceof Error ? error.message : "Unknown error",
      recoverable: false,
    });
  }
}

export interface InboxQuery {
  projectSlug: string;
  agentName: string;
  limit?: number;
  urgent?: boolean;
  unread?: boolean;
  since?: string;
}

/**
 * Fetch inbox for an agent.
 */
export function fetchInbox(query: InboxQuery): Result<InboxMessage[], ApiError> {
  const db = getDb();

  // Get project and agent
  const projectResult = getProject(query.projectSlug);
  if (!projectResult.ok) return projectResult;
  const project = projectResult.value;

  const agentResult = getAgent(query.projectSlug, query.agentName);
  if (!agentResult.ok) return agentResult;
  const agent = agentResult.value;

  let sql = `
    SELECT 
      m.*,
      mr.read_ts,
      mr.ack_ts,
      s.name as sender_name
    FROM messages m
    JOIN message_recipients mr ON m.id = mr.message_id
    JOIN agents s ON m.sender_id = s.id
    WHERE mr.agent_id = ? AND m.project_id = ?
  `;
  const params: (number | string)[] = [agent.id, project.id];

  if (query.urgent) {
    sql += " AND m.importance IN ('high', 'urgent')";
  }

  if (query.unread) {
    sql += " AND mr.read_ts IS NULL";
  }

  if (query.since) {
    sql += " AND m.created_ts > ?";
    params.push(query.since);
  }

  sql += " ORDER BY m.created_ts DESC";

  if (query.limit) {
    sql += " LIMIT ?";
    params.push(query.limit);
  }

  const messages = db.query<InboxMessage, (number | string)[]>(sql).all(...params);

  return Ok(messages);
}

export interface OutboxQuery {
  projectSlug: string;
  agentName: string;
  limit?: number;
}

/**
 * Fetch outbox for an agent.
 */
export function fetchOutbox(query: OutboxQuery): Result<MessageWithSender[], ApiError> {
  const db = getDb();

  // Get project and agent
  const projectResult = getProject(query.projectSlug);
  if (!projectResult.ok) return projectResult;
  const project = projectResult.value;

  const agentResult = getAgent(query.projectSlug, query.agentName);
  if (!agentResult.ok) return agentResult;
  const agent = agentResult.value;

  let sql = `
    SELECT m.*, a.name as sender_name
    FROM messages m
    JOIN agents a ON m.sender_id = a.id
    WHERE m.sender_id = ? AND m.project_id = ?
    ORDER BY m.created_ts DESC
  `;
  const params: (number | string)[] = [agent.id, project.id];

  if (query.limit) {
    sql += " LIMIT ?";
    params.push(query.limit);
  }

  const messages = db.query<MessageWithSender, (number | string)[]>(sql).all(...params);

  return Ok(messages);
}

/**
 * Get a single message by ID.
 */
export function getMessage(messageId: number): Result<MessageWithSender, ApiError> {
  const db = getDb();

  const message = db.query<MessageWithSender, [number]>(`
    SELECT m.*, a.name as sender_name
    FROM messages m
    JOIN agents a ON m.sender_id = a.id
    WHERE m.id = ?
  `).get(messageId);

  if (!message) {
    return Err({
      type: "MESSAGE_NOT_FOUND",
      message: `Message not found: ${messageId}`,
      recoverable: true,
    });
  }

  return Ok(message);
}

/**
 * Mark a message as read.
 */
export function markRead(projectSlug: string, agentName: string, messageId: number): Result<{ read: boolean; readAt: string }, ApiError> {
  const db = getDb();

  const agentResult = getAgent(projectSlug, agentName);
  if (!agentResult.ok) return agentResult;
  const agent = agentResult.value;

  const recipient = db.query<MessageRecipient, [number, number]>(
    "SELECT * FROM message_recipients WHERE message_id = ? AND agent_id = ?"
  ).get(messageId, agent.id);

  if (!recipient) {
    return Err({
      type: "NOT_RECIPIENT",
      message: "Agent is not a recipient of this message",
      recoverable: true,
    });
  }

  if (recipient.read_ts) {
    return Ok({ read: true, readAt: recipient.read_ts });
  }

  const now = new Date().toISOString();
  db.run(`
    UPDATE message_recipients 
    SET read_ts = ? 
    WHERE message_id = ? AND agent_id = ?
  `, [now, messageId, agent.id]);

  return Ok({ read: true, readAt: now });
}

/**
 * Acknowledge a message.
 */
export function acknowledge(projectSlug: string, agentName: string, messageId: number): Result<{ acknowledged: boolean; ackAt: string; readAt: string }, ApiError> {
  const db = getDb();

  const agentResult = getAgent(projectSlug, agentName);
  if (!agentResult.ok) return agentResult;
  const agent = agentResult.value;

  const recipient = db.query<MessageRecipient, [number, number]>(
    "SELECT * FROM message_recipients WHERE message_id = ? AND agent_id = ?"
  ).get(messageId, agent.id);

  if (!recipient) {
    return Err({
      type: "NOT_RECIPIENT",
      message: "Agent is not a recipient of this message",
      recoverable: true,
    });
  }

  const now = new Date().toISOString();
  
  // Acknowledge also marks as read
  db.run(`
    UPDATE message_recipients 
    SET ack_ts = ?, read_ts = COALESCE(read_ts, ?)
    WHERE message_id = ? AND agent_id = ?
  `, [now, now, messageId, agent.id]);

  const updated = db.query<MessageRecipient, [number, number]>(
    "SELECT * FROM message_recipients WHERE message_id = ? AND agent_id = ?"
  ).get(messageId, agent.id);

  return Ok({
    acknowledged: true,
    ackAt: updated!.ack_ts!,
    readAt: updated!.read_ts!,
  });
}
