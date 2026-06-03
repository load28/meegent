/**
 * Superpowers-style workflow orchestration for meeagent.
 *
 *   /workflow brainstorm | plan | build | review | status | off
 *
 * Phases tier the model: brainstorm/plan/controller run on the premium model,
 * execute runs on the cheap model. Each phase injects its skill instruction as a
 * stable system-prompt prefix (prefix-cache friendly, like memory's frozen
 * block). After an execute turn, a two-stage isolated reviewer (premium) judges
 * the diff; on pass the plan task is checked off and committed, on fail the
 * feedback is sent back to the cheap implementer to fix.
 *
 * Doc writing (design/plan) stays possible during brainstorm/plan via the normal
 * diff-approval gate; the "no implementation before approval" rule is enforced at
 * the prompt level by the brainstorming skill's HARD-GATE (mirrors Superpowers).
 *
 * Runtime wiring — verified by typecheck; end-to-end exercised in a session with
 * an OPENROUTER_API_KEY (see docs/superpowers/specs/2026-06-03-spike-notes.md).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ModeState } from "../mode-state.js";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createWorkflowState } from "./state.js";
import { parseTasks, markDone, type PlanTask } from "./docs.js";
import { loadSkill, type SkillName } from "./skills.js";
import { resolveModel, swapTo, DEFAULT_EXEC_MODEL, DEFAULT_REVIEW_MODEL } from "./tiering.js";
import { reviewTwoStage } from "./reviewer.js";

interface WorkflowConfig {
  execModel: string;
  reviewModel: string;
}

function loadConfig(cwd: string): WorkflowConfig {
  try {
    const raw = JSON.parse(readFileSync(join(cwd, ".pi", "settings.json"), "utf8")) as {
      workflow?: Partial<WorkflowConfig>;
    };
    const wf = raw.workflow ?? {};
    return {
      execModel: wf.execModel ?? DEFAULT_EXEC_MODEL,
      reviewModel: wf.reviewModel ?? DEFAULT_REVIEW_MODEL,
    };
  } catch {
    return { execModel: DEFAULT_EXEC_MODEL, reviewModel: DEFAULT_REVIEW_MODEL };
  }
}

const PLANS_DIR = join("docs", "superpowers", "plans");

/** Most recently named plan file under docs/superpowers/plans, or undefined. */
function latestPlanFile(cwd: string): string | undefined {
  try {
    const files = readdirSync(join(cwd, PLANS_DIR)).filter((f) => f.endsWith(".md")).sort();
    return files.length ? join(PLANS_DIR, files[files.length - 1]) : undefined;
  } catch {
    return undefined;
  }
}

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: (r.status ?? 1) === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const PHASE_SKILL: Record<string, SkillName> = {
  brainstorm: "brainstorming",
  plan: "writing-plans",
  execute: "tdd",
};

export function setupWorkflow(pi: ExtensionAPI, mode: ModeState): void {
  const wf = createWorkflowState();
  let planFile: string | undefined;
  let reviewing = false; // re-entrancy guard for the agent_end review

  function notify(ctx: ExtensionContext, msg: string, level: "info" | "warning" | "error" = "info"): void {
    if (ctx.hasUI) ctx.ui.notify(msg, level);
  }

  async function enterPhase(ctx: ExtensionContext, phase: "brainstorm" | "plan" | "execute"): Promise<void> {
    const cfg = loadConfig(ctx.cwd);
    wf.setPhase(phase);
    const ref = phase === "execute" ? cfg.execModel : cfg.reviewModel;
    const model = resolveModel(ctx, ref);
    if (model) {
      const ok = await swapTo(pi, model);
      if (!ok) notify(ctx, `모델 전환 실패(API 키 없음?): ${ref}`, "warning");
    } else {
      notify(ctx, `모델 resolve 실패: ${ref}`, "warning");
    }
    if (phase === "execute") mode.set("default"); // edits go through diff-approval
    notify(ctx, `workflow: ${phase} (${ref})`);
  }

  pi.registerCommand("workflow", {
    description:
      "Superpowers 워크플로우 — brainstorm|plan|build|review|status|off (실행=저가모델, 리뷰=프리미엄)",
    handler: async (args, ctx) => {
      const [cmd, ...rest] = args.trim().split(/\s+/);
      switch (cmd) {
        case "brainstorm":
          await enterPhase(ctx, "brainstorm");
          break;
        case "plan":
          await enterPhase(ctx, "plan");
          break;
        case "build":
        case "execute":
          planFile = rest[0] ? join(PLANS_DIR, rest[0]) : latestPlanFile(ctx.cwd);
          if (!planFile || !existsSync(join(ctx.cwd, planFile))) {
            notify(ctx, "플랜 문서를 찾을 수 없습니다. 먼저 /workflow plan 으로 작성하세요.", "warning");
            return;
          }
          await enterPhase(ctx, "execute");
          notify(ctx, `플랜: ${planFile} (task ${wf.taskIndex()})`);
          break;
        case "review":
          await runReview(ctx);
          break;
        case "status": {
          const cfg = loadConfig(ctx.cwd);
          notify(
            ctx,
            `phase=${wf.phase()} task=${wf.taskIndex()} exec=${cfg.execModel} review=${cfg.reviewModel} plan=${planFile ?? "-"}`,
          );
          break;
        }
        case "off":
          wf.reset();
          notify(ctx, "workflow 종료(idle).");
          break;
        default:
          notify(ctx, "사용법: /workflow brainstorm|plan|build|review|status|off", "warning");
      }
    },
  });

  // Inject the current phase's skill instruction as a stable system-prompt prefix.
  pi.on("before_agent_start", async (event) => {
    const phase = wf.phase();
    const skillName = PHASE_SKILL[phase];
    if (!skillName) return;
    let block = loadSkill(skillName);
    if (!block) return;
    if (phase === "execute" && planFile) {
      const task = currentTask();
      if (task) block += `\n\n[현재 TASK ${task.index}] ${task.title}`;
    }
    return { systemPrompt: `${event.systemPrompt}\n\n${block}` };
  });

  // After an execute turn, run the two-stage isolated review.
  pi.on("agent_end", async (_event, ctx) => {
    if (wf.phase() !== "execute" || reviewing) return;
    await runReview(ctx);
  });

  function readPlan(cwd: string): string | undefined {
    if (!planFile) return undefined;
    try {
      return readFileSync(join(cwd, planFile), "utf8");
    } catch {
      return undefined;
    }
  }

  function currentTask(): PlanTask | undefined {
    return planTasks?.[wf.taskIndex()];
  }
  let planTasks: PlanTask[] | undefined;

  async function runReview(ctx: ExtensionContext): Promise<void> {
    const cfg = loadConfig(ctx.cwd);
    const reviewModel = resolveModel(ctx, cfg.reviewModel);
    if (!reviewModel) {
      notify(ctx, `리뷰 모델 resolve 실패: ${cfg.reviewModel}`, "warning");
      return;
    }
    const planMd = readPlan(ctx.cwd);
    if (!planMd) {
      notify(ctx, "플랜 문서가 없어 리뷰를 건너뜁니다.", "warning");
      return;
    }
    planTasks = parseTasks(planMd);
    const task = currentTask();
    if (!task) {
      notify(ctx, "모든 task 완료 — verify 단계로.", "info");
      wf.setPhase("verify");
      return;
    }

    const diff = git(ctx.cwd, ["diff", "HEAD"]).out || "(no diff vs HEAD)";
    const testRun = spawnSync("bun", ["run", "test"], { cwd: ctx.cwd, encoding: "utf8" });
    const testOutput = `${testRun.stdout ?? ""}${testRun.stderr ?? ""}`.slice(-4000);

    reviewing = true;
    try {
      const result = await reviewTwoStage(ctx, reviewModel, loadSkill("code-review"), {
        taskSpec: task.title,
        diff,
        testOutput,
      });

      if (result.pass) {
        const updated = markDone(planMd, task.index);
        try {
          writeFileSync(join(ctx.cwd, planFile!), updated, "utf8");
        } catch { /* ignore */ }
        git(ctx.cwd, ["add", "-A"]);
        git(ctx.cwd, ["commit", "-m", `workflow: task ${task.index} — ${task.title}`]);
        wf.nextTask();
        notify(ctx, `✅ task ${task.index} 통과 — 커밋 후 다음 task(${wf.taskIndex()}).`);
      } else {
        const blocking = result.stages
          .flatMap((s) => s.verdict.issues)
          .filter((i) => i.severity === "Critical" || i.severity === "Important")
          .map((i) => `- [${i.severity}] ${i.text}`)
          .join("\n");
        notify(ctx, `❌ task ${task.index} 리뷰 실패 — 수정 재투입.`, "warning");
        pi.sendMessage(
          {
            customType: "meeagent-review-feedback",
            content: `리뷰 피드백(아래 이슈를 수정하고 같은 task를 다시 완료하세요):\n${blocking}`,
            display: true,
          },
          { triggerTurn: true },
        );
      }
    } finally {
      reviewing = false;
    }
  }
}
