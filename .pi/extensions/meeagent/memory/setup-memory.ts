import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defaultRoot, paths, projectKey, DISTILL_LOG_THRESHOLD, DISTILL_INTERVAL_MS, MEMORY_MAX_CHARS } from "./paths.js";
import { readMemory, writeMemory, appendRawLog, readState, writeState } from "./store.js";
import { extractSessionSummary } from "./extract.js";
import { buildMemoryBlock } from "./inject.js";
import { isDistillDue } from "./schedule.js";
import { runLLM } from "./llm.js";
import { distillProject } from "./distill.js";
import { synthesizeGlobal } from "./synthesize.js";
import { readdirSync } from "node:fs";
import { join } from "node:path";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function setupMemory(pi: ExtensionAPI): void {
  const root = defaultRoot();
  let frozenBlock = "";

  // Freeze the memory block at session start; run distill if due.
  pi.on("session_start", async (_event, ctx) => {
    const p = paths(root, ctx.cwd);
    frozenBlock = buildMemoryBlock(readMemory(p.projectMemory), readMemory(p.globalMemory));

    const state = readState(p.state);
    const ps = state.projects[projectKey(ctx.cwd)] ?? { lastDistillTs: 0, undistilledLogCount: 0 };
    if (isDistillDue(ps, Date.now(), { threshold: DISTILL_LOG_THRESHOLD, intervalMs: DISTILL_INTERVAL_MS })) {
      await runDistill(ctx, root);
    }
  });

  // Inject the frozen block into every turn's system prompt.
  pi.on("before_agent_start", async (event) => {
    if (!frozenBlock) return;
    return { systemPrompt: `${event.systemPrompt}\n\n# Learned memory\n${frozenBlock}` };
  });

  // Capture a raw-log summary when a prompt finishes.
  pi.on("agent_end", async (event, ctx) => {
    const summary = extractSessionSummary(event.messages as never);
    if (!summary) return;
    const p = paths(root, ctx.cwd);
    appendRawLog(p.projectLogDir, today(), summary);
    const state = readState(p.state);
    const k = projectKey(ctx.cwd);
    const ps = state.projects[k] ?? { lastDistillTs: 0, undistilledLogCount: 0 };
    state.projects[k] = { ...ps, undistilledLogCount: ps.undistilledLogCount + 1 };
    writeState(p.state, state);
  });

  // /learn-global: synthesize global memory across all projects.
  pi.registerCommand("learn-global", {
    description: "Synthesize global memory from all project memories",
    handler: async (_args, ctx) => {
      const projectsDir = join(root, "projects");
      let dirs: string[] = [];
      try { dirs = readdirSync(projectsDir); } catch { dirs = []; }
      const memories = dirs
        .map((d) => readMemory(join(projectsDir, d, "MEMORY.md")))
        .filter((m) => m.trim());
      const p = paths(root, ctx.cwd);
      const res = await synthesizeGlobal({
        projectMemories: memories,
        currentGlobal: readMemory(p.globalMemory),
        maxChars: MEMORY_MAX_CHARS,
        runLLM: (s, u) => runLLM(ctx, s, u),
        writeGlobal: (c) => writeMemory(p.globalMemory, c),
      });
      ctx.ui.notify(res.updated ? "Global memory updated." : "No project memory to synthesize.", "info");
    },
  });
}

async function runDistill(ctx: ExtensionContext, root: string): Promise<void> {
  const p = paths(root, ctx.cwd);
  let raw = "";
  try {
    for (const f of readdirSync(p.projectLogDir)) raw += `${readMemory(join(p.projectLogDir, f))}\n`;
  } catch { return; }

  const result = await distillProject({
    rawLogs: raw,
    projectMemoryFile: p.projectMemory,
    globalMemoryFile: p.globalMemory,
    maxChars: MEMORY_MAX_CHARS,
    runLLM: (s, u) => runLLM(ctx, s, u),
    read: readMemory,
    write: writeMemory,
  });

  const state = readState(p.state);
  state.projects[projectKey(ctx.cwd)] = { lastDistillTs: Date.now(), undistilledLogCount: 0 };
  writeState(p.state, state);
  if (ctx.hasUI && result.factCount > 0) ctx.ui.notify(`Learned ${result.factCount} facts.`, "info");
}
