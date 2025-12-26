import { loadConfig } from "../config.js";
import type { Result, ApiError } from "../types.js";
import { Ok, Err } from "../types.js";

/**
 * Make an API request to the server.
 */
export async function apiRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, string | undefined>
): Promise<Result<T, ApiError>> {
  const config = loadConfig();
  const baseUrl = `http://localhost:${config.port}`;

  let url = `${baseUrl}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        params.set(key, value);
      }
    }
    const queryString = params.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
  }

  try {
    const response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();

    if (!response.ok) {
      if (data.error) {
        return Err(data.error as ApiError);
      }
      return Err({
        type: "API_ERROR",
        message: `HTTP ${response.status}: ${response.statusText}`,
        recoverable: false,
      });
    }

    return Ok(data as T);
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("fetch")) {
      return Err({
        type: "SERVER_UNAVAILABLE",
        message: "Server not running. Start with: am serve",
        recoverable: true,
      });
    }
    return Err({
      type: "API_ERROR",
      message: error instanceof Error ? error.message : "Unknown error",
      recoverable: false,
    });
  }
}

/**
 * Check if server is running.
 */
export async function isServerRunning(): Promise<boolean> {
  const result = await apiRequest<{ status: string }>("GET", "/health");
  return result.ok;
}
