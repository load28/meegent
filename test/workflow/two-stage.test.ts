import { describe, it, expect } from "vitest";
import {
  orchestrateTwoStage,
  parseVerdict,
  type ReviewStage,
  type ReviewInput,
} from "../../.pi/extensions/meeagent/workflow/reviewer.js";

const input: ReviewInput = { taskSpec: "do X", diff: "+x", testOutput: "ok" };

describe("workflow two-stage orchestration (stub runner)", () => {
  it("runs both stages in order when stage 1 passes", async () => {
    const seen: ReviewStage[] = [];
    const res = await orchestrateTwoStage(input, async (stage) => {
      seen.push(stage);
      return parseVerdict("VERDICT: PASS");
    });
    expect(seen).toEqual(["spec-compliance", "code-quality"]);
    expect(res.pass).toBe(true);
    expect(res.stages.map((s) => s.stage)).toEqual(["spec-compliance", "code-quality"]);
  });

  it("short-circuits: code-quality never runs if spec-compliance fails", async () => {
    const seen: ReviewStage[] = [];
    const res = await orchestrateTwoStage(input, async (stage) => {
      seen.push(stage);
      return parseVerdict("[Critical] missing requirement\nVERDICT: FAIL");
    });
    expect(seen).toEqual(["spec-compliance"]);
    expect(res.pass).toBe(false);
    expect(res.stages).toHaveLength(1);
  });

  it("fails overall when stage 2 finds a blocking issue", async () => {
    const res = await orchestrateTwoStage(input, async (stage) =>
      stage === "spec-compliance"
        ? parseVerdict("VERDICT: PASS")
        : parseVerdict("[Important] no edge-case test\nVERDICT: FAIL"),
    );
    expect(res.pass).toBe(false);
    expect(res.stages).toHaveLength(2);
  });
});
