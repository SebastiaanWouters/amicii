import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { Config } from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";

const AMICII_DIR = join(homedir(), ".amicii");
const CONFIG_PATH = join(AMICII_DIR, "config.json");
const DB_PATH = join(AMICII_DIR, "storage.sqlite");
const PID_PATH = join(AMICII_DIR, "amicii.pid");
const LOG_PATH = join(AMICII_DIR, "amicii.log");

export const paths = {
  dir: AMICII_DIR,
  config: CONFIG_PATH,
  db: DB_PATH,
  pid: PID_PATH,
  log: LOG_PATH,
};

/**
 * Ensure ~/.amicii directory exists.
 */
export function ensureDir(): void {
  if (!existsSync(AMICII_DIR)) {
    mkdirSync(AMICII_DIR, { recursive: true });
  }
}

/**
 * Load config from ~/.amicii/config.json, creating with defaults if missing.
 */
export function loadConfig(): Config {
  ensureDir();

  if (!existsSync(CONFIG_PATH)) {
    saveConfig(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      port: parsed.port ?? DEFAULT_CONFIG.port,
      retention_days: parsed.retention_days ?? DEFAULT_CONFIG.retention_days,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Save config to ~/.amicii/config.json.
 */
export function saveConfig(config: Config): void {
  ensureDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

/**
 * Update a single config value.
 */
export function updateConfig(key: keyof Config, value: number): Config {
  const config = loadConfig();
  config[key] = value;
  saveConfig(config);
  return config;
}

/**
 * Get current config value by key.
 */
export function getConfigValue<K extends keyof Config>(key: K): Config[K] {
  return loadConfig()[key];
}

/**
 * Write PID file for daemon mode.
 */
export function writePid(pid: number): void {
  ensureDir();
  writeFileSync(PID_PATH, String(pid));
}

/**
 * Read PID file, returns null if not exists or invalid.
 */
export function readPid(): number | null {
  if (!existsSync(PID_PATH)) return null;
  try {
    const pid = parseInt(readFileSync(PID_PATH, "utf-8").trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * Remove PID file.
 */
export function removePid(): void {
  if (existsSync(PID_PATH)) {
    const { unlinkSync } = require("fs");
    unlinkSync(PID_PATH);
  }
}

/**
 * Check if a process is running by PID.
 */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if server daemon is running.
 */
export function isDaemonRunning(): { running: boolean; pid: number | null } {
  const pid = readPid();
  if (pid === null) return { running: false, pid: null };
  const running = isProcessRunning(pid);
  if (!running) {
    removePid(); // Cleanup stale PID file
  }
  return { running, pid: running ? pid : null };
}
