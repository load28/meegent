/**
 * Pure workflow state machine for the Superpowers-style pipeline:
 *   idle → brainstorm → plan → (execute ⇄ review)* → verify → finish
 *
 * Holds the current phase and the current task index (which task in the plan
 * document is being executed). No pi dependencies — unit-tested in isolation.
 */

export type Phase = "idle" | "brainstorm" | "plan" | "execute" | "review" | "verify" | "finish";

export type PhaseChangeListener = (next: Phase, prev: Phase) => void;

export interface WorkflowState {
  phase(): Phase;
  setPhase(p: Phase): void;
  taskIndex(): number;
  setTaskIndex(n: number): void;
  nextTask(): number;
  reset(): void;
  onPhaseChange(listener: PhaseChangeListener): void;
}

export function createWorkflowState(initial: Phase = "idle"): WorkflowState {
  let phase: Phase = initial;
  let taskIndex = 0;
  const listeners: PhaseChangeListener[] = [];

  function change(next: Phase): void {
    if (next === phase) return;
    const prev = phase;
    phase = next;
    for (const l of listeners) l(next, prev);
  }

  return {
    phase: () => phase,
    setPhase: (p) => change(p),
    taskIndex: () => taskIndex,
    setTaskIndex: (n) => { taskIndex = Math.max(0, Math.floor(n)); },
    nextTask: () => ++taskIndex,
    reset: () => {
      taskIndex = 0;
      change("idle");
    },
    onPhaseChange: (listener) => { listeners.push(listener); },
  };
}
