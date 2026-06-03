import { describe, it, expect } from "vitest";
import {
  classifyMcpProxyCall,
  getMcpProxyTargetTool,
  isMcpMutatingTool,
} from "../../.pi/extensions/meeagent/mcp/mcp-safety.js";

describe("getMcpProxyTargetTool", () => {
  it("returns the tool name for a call shape", () => {
    expect(getMcpProxyTargetTool({ tool: "serena_find_symbol", args: "{}" })).toBe("serena_find_symbol");
  });

  it("returns undefined for meta ops (no tool field)", () => {
    expect(getMcpProxyTargetTool({ search: "symbol" })).toBeUndefined();
    expect(getMcpProxyTargetTool({ describe: "serena_find_symbol" })).toBeUndefined();
    expect(getMcpProxyTargetTool({ connect: "serena" })).toBeUndefined();
    expect(getMcpProxyTargetTool({})).toBeUndefined();
  });

  it("ignores blank/non-string tool values", () => {
    expect(getMcpProxyTargetTool({ tool: "   " })).toBeUndefined();
    expect(getMcpProxyTargetTool({ tool: 42 })).toBeUndefined();
  });
});

describe("isMcpMutatingTool", () => {
  it("flags Serena editing / refactoring / shell tools", () => {
    for (const name of [
      "serena_replace_symbol_body",
      "serena_insert_after_symbol",
      "serena_insert_before_symbol",
      "serena_replace_regex",
      "serena_create_text_file",
      "serena_safe_delete",
      "serena_rename",
      "serena_move",
      "serena_inline",
      "serena_execute_shell_command",
      "serena_write_memory",
    ]) {
      expect(isMcpMutatingTool(name), name).toBe(true);
    }
  });

  it("treats Serena read/navigation tools as non-mutating", () => {
    for (const name of [
      "serena_find_symbol",
      "serena_get_symbols_overview",
      "serena_find_referencing_symbols",
      "serena_search_for_pattern",
      "serena_read_file",
      "serena_list_dir",
      "serena_find_file",
      "serena_read_memory",
      "serena_list_memories",
      "serena_get_current_config",
    ]) {
      expect(isMcpMutatingTool(name), name).toBe(false);
    }
  });

  it("matches across separator and prefix variants", () => {
    expect(isMcpMutatingTool("replace-symbol")).toBe(true);
    expect(isMcpMutatingTool("REPLACE_SYMBOL_BODY")).toBe(true);
    expect(isMcpMutatingTool("find_symbol")).toBe(false);
  });
});

describe("classifyMcpProxyCall", () => {
  it("classifies meta ops as read-only", () => {
    expect(classifyMcpProxyCall({ search: "foo" })).toEqual({ kind: "meta" });
    expect(classifyMcpProxyCall({})).toEqual({ kind: "meta" });
  });

  it("classifies read tools", () => {
    expect(classifyMcpProxyCall({ tool: "serena_find_symbol" })).toEqual({
      kind: "read",
      toolName: "serena_find_symbol",
    });
  });

  it("classifies mutating tools", () => {
    expect(classifyMcpProxyCall({ tool: "serena_replace_symbol_body", args: "{}" })).toEqual({
      kind: "mutate",
      toolName: "serena_replace_symbol_body",
    });
  });
});
