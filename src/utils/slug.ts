/**
 * Create a URL-safe slug from a path or string.
 * Matches mcp_agent_mail's slugify behavior.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * Create a project slug from an absolute path.
 * Takes last 2 path components + hash suffix for uniqueness.
 */
export function projectSlug(humanKey: string): string {
  const parts = humanKey.split("/").filter(Boolean);
  const relevant = parts.slice(-2).join("-");
  const hash = simpleHash(humanKey).slice(0, 8);
  return slugify(`${relevant}-${hash}`);
}

/**
 * Simple string hash for slug suffix.
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}
