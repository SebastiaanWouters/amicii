// Result type (Rust-style error handling)
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });

// API Error
export interface ApiError {
  type: string;
  message: string;
  recoverable?: boolean;
  data?: Record<string, unknown>;
}

// Database entities
export interface Project {
  id: number;
  slug: string;
  human_key: string;
  created_at: string;
}

export interface Agent {
  id: number;
  project_id: number;
  name: string;
  program: string;
  model: string;
  task_description: string;
  inception_ts: string;
  last_active_ts: string;
}

export interface Message {
  id: number;
  project_id: number;
  sender_id: number;
  thread_id: string | null;
  subject: string;
  body_md: string;
  to_agents: string;
  cc_agents: string;
  importance: "low" | "normal" | "high" | "urgent";
  ack_required: number; // SQLite uses 0/1 for boolean
  created_ts: string;
}

export interface MessageRecipient {
  message_id: number;
  agent_id: number;
  kind: "to" | "cc" | "bcc";
  read_ts: string | null;
  ack_ts: string | null;
}

export interface FileReservation {
  id: number;
  project_id: number;
  agent_id: number;
  path_pattern: string;
  exclusive: number; // SQLite uses 0/1 for boolean
  reason: string;
  created_ts: string;
  expires_ts: string;
  released_ts: string | null;
}

// API request/response types
export interface EnsureProjectRequest {
  human_key: string;
}

export interface RegisterAgentRequest {
  project_slug: string;
  name?: string;
  program: string;
  model: string;
  task_description?: string;
}

export interface SendMessageRequest {
  project_slug: string;
  sender: string;
  to: string[];
  cc?: string[];
  subject: string;
  body_md: string;
  thread_id?: string;
  importance?: "low" | "normal" | "high" | "urgent";
  ack_required?: boolean;
}

export interface CreateReservationRequest {
  project_slug: string;
  agent: string;
  path_pattern: string;
  ttl_seconds?: number;
  exclusive?: boolean;
  reason?: string;
}

export interface ReleaseReservationRequest {
  project_slug: string;
  agent: string;
  pattern?: string;
  all?: boolean;
}

// Inbox/outbox query params
export interface InboxQuery {
  project: string;
  agent: string;
  limit?: number;
  urgent?: boolean;
  unread?: boolean;
  since?: string;
}

export interface OutboxQuery {
  project: string;
  agent: string;
  limit?: number;
}

export interface SearchQuery {
  project: string;
  q: string;
  limit?: number;
}

// Extended types for API responses
export interface MessageWithSender extends Message {
  sender_name: string;
}

export interface InboxMessage extends MessageWithSender {
  read_ts: string | null;
  ack_ts: string | null;
}

export interface ReservationWithAgent extends FileReservation {
  agent_name: string;
}

export interface ReservationConflict {
  id: number;
  agent_name: string;
  path_pattern: string;
  expires_ts: string;
  reason: string;
}

export interface ReservationResult {
  granted: FileReservation[];
  conflicts: ReservationConflict[];
}

// Config
export interface Config {
  port: number;
  retention_days: number;
}

export const DEFAULT_CONFIG: Config = {
  port: 8765,
  retention_days: 30,
};

// Server status
export interface ServerStatus {
  status: "ok";
  version: string;
  uptime_seconds: number;
  projects_count: number;
  agents_count: number;
  messages_count: number;
  reservations_active: number;
  retention_days: number;
}
