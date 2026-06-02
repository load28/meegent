import { describe, it, expect } from "vitest";
import { isDestructiveBash } from "../.pi/extensions/meeagent/bash-safety.js";

describe("isDestructiveBash", () => {
  it("flags writes/deletes", () => {
    expect(isDestructiveBash("rm -rf build")).toBe(true);
    expect(isDestructiveBash("mv a b")).toBe(true);
    expect(isDestructiveBash("echo hi > file.txt")).toBe(true);
    expect(isDestructiveBash("git commit -m x")).toBe(true);
    expect(isDestructiveBash("npm install left-pad")).toBe(true);
  });

  it("allows read-only commands", () => {
    expect(isDestructiveBash("cat file.txt")).toBe(false);
    expect(isDestructiveBash("grep -r foo src")).toBe(false);
    expect(isDestructiveBash("git status")).toBe(false);
    expect(isDestructiveBash("ls -la")).toBe(false);
    expect(isDestructiveBash("rg pattern")).toBe(false);
  });

  it("treats append redirection as destructive", () => {
    expect(isDestructiveBash("cat a >> b")).toBe(true);
  });
});
