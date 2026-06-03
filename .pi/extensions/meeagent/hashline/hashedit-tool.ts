import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Type } from "typebox";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { preparePatch } from "./patch.js";

const DESCRIPTION = [
  "Edit existing files via hashline patches. Anchor on the `¶PATH#TAG` header and 1-indexed line",
  "numbers from your most recent `read`. The whole patch goes in `input`:",
  "",
  "*** Begin Patch",
  "¶path/to/file#TAG",
  "replace 12..14:",
  "+  new line content",
  "insert after 20:",
  "+  appended line",
  "delete 30..31",
  "*** End Patch",
  "",
  "Body rows are ONLY `+TEXT` (the final content, verbatim; `+` alone = blank line; `++x`/`+-x` to",
  "emit a literal leading +/-). Never write `-old` or context rows — the range does the deleting.",
  "RE-GROUND after every edit: each applied edit mints a fresh #TAG and renumbers the file, so the",
  "tag/line numbers you just used are dead — use the ¶path#TAG and lines from the edit response or",
  "re-`read`. To create a NEW file use `write`, not hashedit.",
].join("\n");

const parameters = Type.Object({ input: Type.String() });

/** Register the hashedit tool: applies a hashline patch and hands back a refreshed anchor view. */
export function setupHashlineTool(pi: ExtensionAPI): void {
  pi.registerTool(defineTool({
    name: "hashedit",
    label: "Edit",
    description: DESCRIPTION,
    promptSnippet: "hashedit: edit existing files with a hashline patch (¶path#TAG + line-number anchors).",
    parameters,
    execute: async (_id, params, _signal, _onUpdate, ctx) => {
      const { input } = params as { input: string };
      const res = preparePatch(input, (p) =>
        readFileSync(resolve(ctx.cwd, p.replace(/^@/, "")), "utf8"),
      );
      if (!res.ok) {
        return { content: [{ type: "text", text: res.error }], details: undefined };
      }
      for (const f of res.files) {
        writeFileSync(resolve(ctx.cwd, f.path.replace(/^@/, "")), f.newContent, "utf8");
      }
      // Re-ground: hand back the fresh tag + renumbered view for each edited file.
      const text = res.files.map((f) => `Edited ${f.path}.\n${f.newView}`).join("\n\n");
      return { content: [{ type: "text", text }], details: undefined };
    },
  }));
}
