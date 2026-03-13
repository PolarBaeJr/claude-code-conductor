/**
 * Tests for C-1 fix: CodexUsageMonitor.waitForReset() iteration limit.
 *
 * C-1 (CRITICAL): waitForReset() had no iteration limit, creating
 * an infinite loop risk. The fix adds MAX_WAIT_ITERATIONS=60 guard
 * matching the UsageMonitor pattern (H23 fix).
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("CodexUsageMonitor C-1 fix: waitForReset iteration limit", () => {
  it("source code has MAX_WAIT_ITERATIONS constant", async () => {
    const source = await fs.readFile(
      path.join(__dirname, "codex-usage-monitor.ts"),
      "utf-8",
    );

    // C-1: Must define MAX_WAIT_ITERATIONS
    expect(source).toContain("MAX_WAIT_ITERATIONS");
    // Should be set to 60 to match UsageMonitor
    expect(source).toMatch(/MAX_WAIT_ITERATIONS\s*=\s*60/);
  });

  it("waitForReset method has iteration counter and break condition", async () => {
    const source = await fs.readFile(
      path.join(__dirname, "codex-usage-monitor.ts"),
      "utf-8",
    );

    // Find the waitForReset method
    const methodStart = source.indexOf("async waitForReset");
    expect(methodStart).toBeGreaterThan(-1);

    // Use a larger window to capture the full method body including break and error log
    const methodBody = source.substring(methodStart, methodStart + 2000);

    // Must have an iteration counter
    expect(methodBody).toContain("iterations");
    // Must check iterations against MAX_WAIT_ITERATIONS
    expect(methodBody).toContain("MAX_WAIT_ITERATIONS");
    // Must have a break statement to exit the loop
    expect(methodBody).toContain("break");
    // Must log an error when max iterations exceeded
    expect(methodBody).toContain("exceeded max iterations");
  });

  it("iteration counter increments inside the while loop", async () => {
    const source = await fs.readFile(
      path.join(__dirname, "codex-usage-monitor.ts"),
      "utf-8",
    );

    const methodStart = source.indexOf("async waitForReset");
    // Use a larger window to capture the full method body including iterations++
    const methodBody = source.substring(methodStart, methodStart + 2000);

    // The while loop should increment iterations
    expect(methodBody).toContain("iterations++");

    // Should compare iterations >= MAX_WAIT_ITERATIONS
    expect(methodBody).toMatch(/iterations\s*>=\s*MAX_WAIT_ITERATIONS/);
  });
});
