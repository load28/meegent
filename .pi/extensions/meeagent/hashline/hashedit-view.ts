import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isReadToolResult, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildView } from "./view.js";
import { snapshots } from "./snapshots.js";

/** Heuristic: treat content with a NUL byte as binary and leave it untouched. */
function looksBinary(s: string): boolean {
  return /\u0000/.test(s);
}

/**
 * Replace `read` output with the hashline anchor view (`¶path#TAG` + `LINE:TEXT`)
 * so the model can author hashedit patches. Binary/unreadable files are left as-is.
 */
export function setupHashlineView(pi: ExtensionAPI): void {
  pi.on("tool_result", async (event, ctx) => {
    if (!isReadToolResult(event)) return;
    // ReadToolInput is a TypeBox Static; read its fields through an explicit shape.
    const { path, offset, limit } = event.input as unknown as { path?: string; offset?: number; limit?: number };
    if (!path) return;
    let content: string;
    try {
      content = readFileSync(resolve(ctx.cwd, path.replace(/^@/, "")), "utf8");
    } catch {
      return; // unreadable → leave host output untouched
    }
    if (looksBinary(content)) return;
    // Record the read snapshot so a later stale edit on this tag can 3-way recover.
    snapshots.record(path, content);
    return { content: [{ type: "text", text: buildView(path, content, offset, limit) }] };
  });
}
