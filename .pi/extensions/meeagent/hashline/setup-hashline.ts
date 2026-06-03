import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setupHashlineTool } from "./hashedit-tool.js";
import { setupHashlineView } from "./hashedit-view.js";

/** Register the hashedit tool and the read→anchor-view rewrite. */
export function setupHashline(pi: ExtensionAPI): void {
  setupHashlineTool(pi);
  setupHashlineView(pi);
}
