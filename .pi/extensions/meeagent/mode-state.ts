export type PermissionMode = "default" | "acceptEdits" | "plan";

const ORDER: PermissionMode[] = ["default", "acceptEdits", "plan"];

export type ModeChangeListener = (next: PermissionMode, prev: PermissionMode) => void;

export interface ModeState {
  current(): PermissionMode;
  cycle(): PermissionMode;
  set(mode: PermissionMode): void;
  onChange(listener: ModeChangeListener): void;
}

export function createModeState(initial: PermissionMode = "default"): ModeState {
  let mode: PermissionMode = initial;
  const listeners: ModeChangeListener[] = [];

  function change(next: PermissionMode): void {
    if (next === mode) return;
    const prev = mode;
    mode = next;
    for (const l of listeners) l(next, prev);
  }

  return {
    current: () => mode,
    cycle: () => {
      const idx = ORDER.indexOf(mode);
      change(ORDER[(idx + 1) % ORDER.length]);
      return mode;
    },
    set: (next) => change(next),
    onChange: (listener) => { listeners.push(listener); },
  };
}
