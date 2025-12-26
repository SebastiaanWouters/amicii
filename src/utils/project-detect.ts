import { resolve } from "path";
import { existsSync } from "fs";

/**
 * Detect project root from current directory.
 * Walks up looking for common project markers.
 */
export function detectProjectRoot(startDir?: string): string | null {
  let dir = resolve(startDir ?? process.cwd());
  const root = "/";

  const markers = [
    ".git",
    "package.json",
    "Cargo.toml",
    "pyproject.toml",
    "go.mod",
    "Makefile",
    ".beads",
  ];

  while (dir !== root) {
    for (const marker of markers) {
      if (existsSync(resolve(dir, marker))) {
        return dir;
      }
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }

  // Fallback to current directory
  return startDir ? resolve(startDir) : process.cwd();
}

/**
 * Get absolute path, resolving relative paths from cwd.
 */
export function resolvePath(input?: string): string {
  if (!input) {
    return detectProjectRoot() ?? process.cwd();
  }
  return resolve(input);
}
