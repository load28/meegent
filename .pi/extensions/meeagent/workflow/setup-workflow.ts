/**
 * Superpowers-style workflow orchestration for meeagent.
 *
 *   /workflow brainstorm | plan | build | review | status | off
 *
 * Phases tier the model: brainstorm/plan/controller run on the premium model,
 * execute runs on the cheap model. Each phase injects its skill instruction as a
 * stable system-prompt prefix (prefix-cache friendly, like memory's frozen
 * block). When the implementer signals a finished task (the task-complete
 * marker), a two-stage isolated reviewer (premium) judges the diff; on pass the
 * plan task is checked off and committed, on fail the feedback is re-injected into
 * the cheap implementer — capped at maxReviewRetries, after which the loop halts
 * and escalates to the human instead of burning premium-review budget.
 *
 * The "no implementation before design approval" HARD-GATE is enforced at the
 * TOOL level (a tool_call hook), not just in the skill text: during brainstorm/
 * plan only design/plan docs may be written and destructive bash is blocked.
 * `/workflow build` resumes at the first unchecked task (skips completed work).
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
import { parseTasks, markDone, firstUndoneIndex, type PlanTask } from "./docs.js";
import { loadSkill, type SkillName } from "./skills.js";
import { resolveModel, swapTo } from "./tiering.js";
import { reviewTwoStage } from "./reviewer.js";
import { loadWorkflowConfig } from "./config.js";
import { summarizeUsage, formatUsage } from "./caching.js";
import { isDocPath, isTaskComplete, decideReviewOutcome, lastAssistantText, TASK_COMPLETE_MARKER } from "./gate.js";
import { isDestructiveBash } from "../bash-safety.js";

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
  let reviewCostUSD = 0; // accumulated premium-review spend this session (instrumentation)
  let retriesUsed = 0; // fix re-injections consumed by the current task
  let blocked = false; // current task exhausted its retries — auto-loop halted, human needed

  function notify(ctx: ExtensionContext, msg: string, level: "info" | "warning" | "error" = "info"): void {
    if (ctx.hasUI) ctx.ui.notify(msg, level);
  }

  async function enterPhase(ctx: ExtensionContext, phase: "brainstorm" | "plan" | "execute"): Promise<void> {
    const cfg = loadWorkflowConfig(ctx.cwd);
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
        case "execute": {
          planFile = rest[0] ? join(PLANS_DIR, rest[0]) : latestPlanFile(ctx.cwd);
          if (!planFile || !existsSync(join(ctx.cwd, planFile))) {
            notify(ctx, "플랜 문서를 찾을 수 없습니다. 먼저 /workflow plan 으로 작성하세요.", "warning");
            return;
          }
          // Resume: load the plan now (so the first execute turn already has task
          // context) and seek past any tasks already checked off.
          const md = readPlan(ctx.cwd);
          planTasks = md ? parseTasks(md) : [];
          wf.setTaskIndex(firstUndoneIndex(planTasks));
          retriesUsed = 0;
          blocked = false;
          if (wf.taskIndex() >= planTasks.length && planTasks.length > 0) {
            notify(ctx, "모든 task가 이미 완료됨 — verify 단계로.", "info");
            wf.setPhase("verify");
            return;
          }
          await enterPhase(ctx, "execute");
          notify(ctx, `플랜: ${planFile} (task ${wf.taskIndex()}/${planTasks.length})`);
          break;
        }
        case "review":
          // Manual review is an explicit human action: clear a prior halt and the
          // retry budget so the fix-loop can resume from a clean slate.
          blocked = false;
          retriesUsed = 0;
          await runReview(ctx);
          break;
        case "status": {
          const cfg = loadWorkflowConfig(ctx.cwd);
          notify(
            ctx,
            `phase=${wf.phase()} task=${wf.taskIndex()} retries=${retriesUsed}/${cfg.maxReviewRetries}` +
              `${blocked ? " ⛔BLOCKED" : ""} exec=${cfg.execModel} review=${cfg.reviewModel} ` +
              `cache=${cfg.cacheRetention} reviewCost=$${reviewCostUSD.toFixed(6)} plan=${planFile ?? "-"}`,
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

  // HARD-GATE (Superpowers): during brainstorm/plan, block code edits and
  // destructive bash at the tool level — not merely via the skill text. Only the
  // design/plan docs under docs/superpowers/ may be written.
  pi.on("tool_call", async (event) => {
    const phase = wf.phase();
    if (phase !== "brainstorm" && phase !== "plan") return;
    if (event.toolName === "hashedit" || event.toolName === "write") {
      const path = String((event.input as { path?: unknown }).path ?? "");
      if (!isDocPath(path)) {
        return {
          block: true,
          reason:
            `${phase} 단계 HARD-GATE: 설계 승인 전에는 코드 편집 금지(설계/플랜 문서만 허용). ` +
            `대상: ${path || "(경로 없음)"} — 구현은 /workflow build 이후에.`,
        };
      }
    }
    if (event.toolName === "bash") {
      const command = String((event.input as { command?: unknown }).command ?? "");
      if (isDestructiveBash(command)) {
        return {
          block: true,
          reason: `${phase} 단계 HARD-GATE: 파괴적 명령 차단(읽기전용 조사만). 대상: ${command}`,
        };
      }
    }
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

  // Review fires once per FINISHED task, not after every execute turn: the
  // implementer prints the task-complete marker when its TDD cycle is done. While
  // blocked (retries exhausted) the auto-loop stays off until the human acts.
  pi.on("agent_end", async (event, ctx) => {
    if (wf.phase() !== "execute" || reviewing || blocked) return;
    if (!isTaskComplete(lastAssistantText(event.messages))) return;
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
    const cfg = loadWorkflowConfig(ctx.cwd);
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
      const result = await reviewTwoStage(
        ctx,
        reviewModel,
        loadSkill("code-review"),
        { taskSpec: task.title, diff, testOutput },
        {
          cacheRetention: cfg.cacheRetention,
          // Both stages share this id so Stage 2 reuses Stage 1's cached prefix.
          sessionId: `meeagent-review-task-${task.index}`,
          onUsage: (u) => {
            const s = summarizeUsage(u);
            reviewCostUSD += s.costUSD;
            notify(ctx, formatUsage(`리뷰 task ${task.index}`, s));
          },
        },
      );

      const outcome = decideReviewOutcome(result.pass, retriesUsed, cfg.maxReviewRetries);
      if (outcome === "advance") {
        const updated = markDone(planMd, task.index);
        try {
          writeFileSync(join(ctx.cwd, planFile!), updated, "utf8");
        } catch { /* ignore */ }
        git(ctx.cwd, ["add", "-A"]);
        git(ctx.cwd, ["commit", "-m", `workflow: task ${task.index} — ${task.title}`]);
        wf.nextTask();
        retriesUsed = 0; // fresh budget for the next task
        notify(ctx, `✅ task ${task.index} 통과 — 커밋 후 다음 task(${wf.taskIndex()}).`);
        return;
      }

      const blocking = result.stages
        .flatMap((s) => s.verdict.issues)
        .filter((i) => i.severity === "Critical" || i.severity === "Important")
        .map((i) => `- [${i.severity}] ${i.text}`)
        .join("\n");

      if (outcome === "halt") {
        blocked = true;
        notify(
          ctx,
          `⛔ task ${task.index} — ${cfg.maxReviewRetries}회 수정에도 리뷰 미통과. 자동 재투입 중단(비용 보호). ` +
            `직접 확인 후 /workflow review 로 재개하세요.\n${blocking}`,
          "error",
        );
        return;
      }

      // retry: re-inject the blocking feedback into the cheap implementer.
      retriesUsed++;
      notify(ctx, `❌ task ${task.index} 리뷰 실패 — 수정 재투입(${retriesUsed}/${cfg.maxReviewRetries}).`, "warning");
      pi.sendMessage(
        {
          customType: "meeagent-review-feedback",
          content:
            `리뷰 피드백(아래 이슈를 수정하고 같은 task를 다시 완료하세요). ` +
            `완료되면 마지막 줄에 ${TASK_COMPLETE_MARKER} 를 출력하세요:\n${blocking}`,
          display: true,
        },
        { triggerTurn: true },
      );
    } finally {
      reviewing = false;
    }
  }
}
