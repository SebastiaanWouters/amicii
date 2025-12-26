// Re-export from types for convenience
export { Ok, Err, type Result, type ApiError } from "../types.js";

/**
 * Wrap a promise in Result type.
 */
export async function tryCatch<T>(
  promise: Promise<T>
): Promise<import("../types.js").Result<T, Error>> {
  try {
    const value = await promise;
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/**
 * Wrap a sync function in Result type.
 */
export function tryCatchSync<T>(fn: () => T): import("../types.js").Result<T, Error> {
  try {
    const value = fn();
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}
