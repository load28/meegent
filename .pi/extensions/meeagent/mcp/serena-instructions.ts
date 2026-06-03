import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Reproduce what a standard MCP client (e.g. Claude Code) does for Serena: surface
 * the server's `instructions` into the system prompt.
 *
 * Serena passes its full symbolic-tools guide as `FastMCP(instructions=...)`
 * (serena/mcp.py) so MCP clients inject it and the model relies on Serena's tools.
 * pi-mcp-adapter never reads that `instructions` field, so under pi the guide is
 * dropped and the model falls back to grep/read. We recover it by asking Serena for
 * the same text directly (`serena print-system-prompt`) and caching it, then
 * appending it to pi's system prompt (see setup-mcp.ts).
 *
 * The context MUST match the running server's (.pi/mcp.json → `--context`) so the
 * injected prompt matches the tools Serena actually exposes.
 */
const SERENA_CONTEXT = "ide-assistant";
const FETCH_TIMEOUT_MS = 60_000;
const PROMPT_MARKER = "You will receive access to Serena";

function agentDir(): string {
  return process.env["PI_CODING_AGENT_DIR"] ?? join(homedir(), ".pi", "agent");
}

function cachePath(): string {
  return join(agentDir(), `meeagent-serena-prompt.${SERENA_CONTEXT}.txt`);
}

// `print-system-prompt` interleaves logger lines with the prompt on stdout, so we
// slice from the known first line; if that moves, drop logger-shaped lines instead.
function extractPrompt(stdout: string): string | null {
  const at = stdout.indexOf(PROMPT_MARKER);
  if (at >= 0) return stdout.slice(at).trim();
  const cleaned = stdout
    .split("\n")
    .filter((l) => !/^\s*(INFO|WARNING|ERROR|DEBUG)\s/.test(l) && !/serena\.[\w.]+:/.test(l))
    .join("\n")
    .trim();
  return cleaned.length > 200 ? cleaned : null;
}

function fetchFromSerena(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "uvx",
      [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena",
        "print-system-prompt",
        "--context",
        SERENA_CONTEXT,
      ],
      { timeout: FETCH_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) return resolve(null);
        resolve(extractPrompt(stdout ?? ""));
      },
    );
  });
}

let cached: string | null = null;
let priming: Promise<void> | null = null;

/** The cached Serena instructions, or null if not fetched yet. Cheap, sync. */
export function serenaInstructions(): string | null {
  if (cached) return cached;
  const path = cachePath();
  if (existsSync(path)) {
    try {
      cached = readFileSync(path, "utf-8").trim() || null;
    } catch {
      cached = null;
    }
  }
  return cached;
}

/**
 * Populate the cache (disk first, else fetch from Serena and persist). Idempotent
 * and safe to call on session_start; the fetch boots Serena once, so we never block
 * a turn on it. Subsequent sessions read the disk cache instantly.
 */
export function primeSerenaInstructions(): Promise<void> {
  if (cached || serenaInstructions()) return Promise.resolve();
  if (priming) return priming;
  priming = fetchFromSerena().then((prompt) => {
    if (!prompt) return;
    cached = prompt;
    try {
      mkdirSync(dirname(cachePath()), { recursive: true });
      writeFileSync(cachePath(), prompt, "utf-8");
    } catch {
      // best-effort cache; in-memory copy still serves this run
    }
  });
  return priming;
}
