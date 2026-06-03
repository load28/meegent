// Safety classification for calls routed through the pi-mcp-adapter `mcp` proxy
// tool. The proxy can invoke ANY tool of a connected MCP server (e.g. Serena),
// including ones that edit files or run shells — which would otherwise bypass
// meeagent's plan mode and diff approval. We classify the proxied target so the
// guard hook can block/confirm mutations, mirroring bash-safety.ts.

/**
 * The `mcp` proxy accepts several shapes (see pi-mcp-adapter):
 *   { search }, { describe }, { server }, { connect }, { action }, { }  → read-only meta ops
 *   { tool, args }                                                      → executes an MCP tool
 * Only the `{ tool }` form actually runs a server tool, so that is the only
 * shape we need to gate. Everything else is treated as read-only.
 */
export function getMcpProxyTargetTool(input: Record<string, unknown>): string | undefined {
  const tool = input["tool"];
  return typeof tool === "string" && tool.trim() ? tool.trim() : undefined;
}

// Verb patterns that indicate a tool mutates the workspace or runs commands.
// Matched against the tool name with separators normalized to spaces, so word
// boundaries work across `serena_replace_symbol_body`, `replace-symbol`, etc.
// Biased toward over-blocking: a misclassified read tool is merely unavailable
// in plan mode, whereas a missed write tool would defeat plan mode entirely.
const MUTATING_PATTERNS: RegExp[] = [
  /\breplace\b/, /\binsert\b/, /\bdelete\b/, /\bremove\b/, /\brename\b/,
  /\bmove\b/, /\binline\b/, /\bcreate\b/, /\bwrite\b/, /\bedit\b/,
  /\bappend\b/, /\bapply\b/, /\bpatch\b/, /\bformat\b/, /\bmodify\b/,
  /\bupdate\b/, /\bset\b/, /\bsave\b/, /\bgenerate\b/, /\bfix\b/,
  /\bexecute\b/, /\bexec\b/, /\bshell\b/, /\bcommand\b/, /\brun\b/,
  /\binstall\b/, /\bmkdir\b/, /\brmdir\b/,
];

/** True if a (possibly server-prefixed) MCP tool name looks like it mutates state. */
export function isMcpMutatingTool(toolName: string): boolean {
  const normalized = toolName.replace(/[_-]+/g, " ").toLowerCase();
  return MUTATING_PATTERNS.some((p) => p.test(normalized));
}

export type McpProxyDecision =
  | { kind: "meta" } // read-only meta op (search/describe/list/connect/...)
  | { kind: "read"; toolName: string } // a server tool that only reads
  | { kind: "mutate"; toolName: string }; // a server tool that edits/executes

/** Classify an `mcp` proxy tool_call so the guard can allow/confirm/block it. */
export function classifyMcpProxyCall(input: Record<string, unknown>): McpProxyDecision {
  const toolName = getMcpProxyTargetTool(input);
  if (!toolName) return { kind: "meta" };
  return isMcpMutatingTool(toolName) ? { kind: "mutate", toolName } : { kind: "read", toolName };
}
