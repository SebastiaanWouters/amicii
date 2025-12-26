/**
 * Output formatting utilities for CLI.
 */

export interface TableColumn {
  key: string;
  label: string;
  width?: number;
}

/**
 * Print data as JSON.
 */
export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Print a simple key-value object.
 */
export function printKeyValue(obj: Record<string, unknown>, indent = 0): void {
  const pad = "  ".repeat(indent);
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "object" && value !== null) {
      console.log(`${pad}${key}:`);
      printKeyValue(value as Record<string, unknown>, indent + 1);
    } else {
      console.log(`${pad}${key}: ${value}`);
    }
  }
}

/**
 * Print a simple table.
 */
export function printTable<T extends Record<string, unknown>>(
  data: T[],
  columns: TableColumn[]
): void {
  if (data.length === 0) {
    console.log("(no results)");
    return;
  }

  // Calculate column widths
  const widths: Record<string, number> = {};
  for (const col of columns) {
    widths[col.key] = col.width ?? Math.max(
      col.label.length,
      ...data.map(row => String(row[col.key] ?? "").length)
    );
  }

  // Print header
  const header = columns.map(col => col.label.padEnd(widths[col.key])).join("  ");
  console.log(header);
  console.log("-".repeat(header.length));

  // Print rows
  for (const row of data) {
    const line = columns.map(col => {
      const value = String(row[col.key] ?? "");
      return value.slice(0, widths[col.key]).padEnd(widths[col.key]);
    }).join("  ");
    console.log(line);
  }
}

/**
 * Print an error message.
 */
export function printError(message: string): void {
  console.error(`Error: ${message}`);
}

/**
 * Print a success message.
 */
export function printSuccess(message: string): void {
  console.log(`✓ ${message}`);
}

/**
 * Format timestamp for display.
 */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/**
 * Truncate string with ellipsis.
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}
