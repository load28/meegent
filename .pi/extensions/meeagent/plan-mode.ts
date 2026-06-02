import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ModeState } from "./mode-state.js";
import { applyMode } from "./permission-mode.js";
import { isDestructiveBash } from "./bash-safety.js";

const PLAN_PROMPT = `[PLAN MODE ACTIVE]
You are in plan mode — a read-only exploration mode for safe code analysis.

Restrictions:
- You may ONLY use: read, bash (read-only), grep, find, ls
- You may NOT use: edit, write (file modifications are disabled)

Investigate the request, then present a concrete plan as Markdown under a "Plan:" header:

Plan:
1. First step
2. Second step
...

Do NOT make changes — only describe what you would do.`;

export function setupPlanMode(pi: ExtensionAPI, state: ModeState): void {
  pi.registerFlag("plan", {
    description: "Start in plan mode (read-only exploration)",
    type: "boolean",
    default: false,
  });

  // Block destructive bash while in plan mode (hard enforcement beyond tool allow-list).
  pi.on("tool_call", async (event) => {
    if (state.current() !== "plan" || event.toolName !== "bash") return;
    const command = String(event.input.command ?? "");
    if (isDestructiveBash(command)) {
      return {
        block: true,
        reason: `Plan mode: destructive command blocked. Exit plan mode (Shift+Tab) to run it.\nCommand: ${command}`,
      };
    }
  });

  // Inject the plan-mode instruction each turn while active.
  pi.on("before_agent_start", async () => {
    if (state.current() !== "plan") return;
    return {
      message: { customType: "meeagent-plan", content: PLAN_PROMPT, display: false },
    };
  });

  // Strip stale plan-mode context once we leave plan mode.
  pi.on("context", async (event) => {
    if (state.current() === "plan") return;
    return {
      messages: event.messages.filter((m) => {
        const msg = m as { customType?: string };
        return msg.customType !== "meeagent-plan";
      }),
    };
  });

  // On plan completion, render the plan (already shown as the assistant's
  // markdown message) and present the approve/reject/custom gate.
  pi.on("agent_end", async (_event, ctx) => {
    if (state.current() !== "plan" || !ctx.hasUI) return;

    const choice = await ctx.ui.select("Plan ready — what next?", [
      "Approve & execute",
      "Stay in plan mode",
      "Refine with feedback",
    ]);

    if (choice === "Approve & execute") {
      state.set("default");           // post-approval mode (per design)
      applyMode(pi, ctx, "default");
      pi.sendMessage(
        { customType: "meeagent-exec", content: "Execute the plan you just presented.", display: true },
        { triggerTurn: true },
      );
    } else if (choice === "Refine with feedback") {
      const feedback = await ctx.ui.editor("Feedback for the plan:", "");
      if (feedback?.trim()) pi.sendUserMessage(feedback.trim());
    }
    // "Stay in plan mode": do nothing — remains in plan.
  });

  // Honor --plan flag and restore tools on session start.
  pi.on("session_start", async (_event, ctx) => {
    if (pi.getFlag("plan") === true) {
      state.set("plan");
      applyMode(pi, ctx, "plan");
    }
  });
}
