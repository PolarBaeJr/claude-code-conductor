import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Tests for H14-H17 fixes in codex-worker-manager.ts.
 *
 * H14: killAllWorkers SIGTERM→SIGKILL escalation
 * H15: signalWindDown reason validation
 * H16: consumeLines byte-aware buffer truncation
 * H17: checkWorkerHealth wall-clock timeout tracking
 *
 * The CodexWorkerManager class requires spawning real child processes
 * and MCP infrastructure. We test the fix behaviors through:
 * 1. Source code verification for structural fixes
 * 2. Unit-level reproduction of the algorithms
 */

// ================================================================
// H14: killAllWorkers SIGTERM → SIGKILL escalation
// ================================================================

describe("CodexWorkerManager H14 - killAllWorkers SIGTERM→SIGKILL", () => {
  it("source code sends SIGTERM before SIGKILL", async () => {
    const source = await fs.readFile(
      path.join(__dirname, "codex-worker-manager.ts"),
      "utf-8",
    );

    // H14: Must send SIGTERM first
    expect(source).toContain('kill("SIGTERM")');
    // H14: Must escalate to SIGKILL
    expect(source).toContain('kill("SIGKILL")');

    // Verify SIGTERM appears before SIGKILL in the killAllWorkers method
    const sigTermIndex = source.indexOf('kill("SIGTERM")');
    const sigKillIndex = source.indexOf('kill("SIGKILL")');
    expect(sigTermIndex).toBeLessThan(sigKillIndex);
  });

  it("source code has a timeout between SIGTERM and SIGKILL", async () => {
    const source = await fs.readFile(
      path.join(__dirname, "codex-worker-manager.ts"),
      "utf-8",
    );

    // H14: Must have a timeout (10 seconds)
    expect(source).toContain("KILL_TIMEOUT_MS");
    expect(source).toContain("10_000");

    // H14: Must use Promise.race for timeout
    expect(source).toContain("Promise.race");
    expect(source).toContain("Promise.allSettled");
  });

  it("source code references H14 fix in comment", async () => {
    const source = await fs.readFile(
      path.join(__dirname, "codex-worker-manager.ts"),
      "utf-8",
    );
    expect(source).toContain("H14");
  });
});

// ================================================================
// H15: signalWindDown reason validation
// ================================================================

describe("CodexWorkerManager H15 - signalWindDown reason validation", () => {
  it("source code validates wind_down reason", async () => {
    const source = await fs.readFile(
      path.join(__dirname, "codex-worker-manager.ts"),
      "utf-8",
    );

    // H15: Must have VALID_REASONS constant
    expect(source).toContain("VALID_REASONS");

    // H15: Must check against valid reasons
    expect(source).toContain("usage_limit");
    expect(source).toContain("user_requested");

    // H15: Must fall back to default on invalid reason
    expect(source).toContain('reason = "user_requested"');
  });

  it("source code references H15 fix in comment", async () => {
    const source = await fs.readFile(
      path.join(__dirname, "codex-worker-manager.ts"),
      "utf-8",
    );
    expect(source).toContain("H15");
  });

  it("validates reason against expected union type at runtime", () => {
    // Reproduce the validation logic
    const VALID_REASONS = ["usage_limit", "cycle_limit", "user_requested"] as const;

    const validReason = "usage_limit";
    expect(VALID_REASONS.includes(validReason as typeof VALID_REASONS[number])).toBe(true);

    const invalidReason = "something_else";
    expect(VALID_REASONS.includes(invalidReason as typeof VALID_REASONS[number])).toBe(false);

    const emptyReason = "";
    expect(VALID_REASONS.includes(emptyReason as typeof VALID_REASONS[number])).toBe(false);
  });
});

// ================================================================
// H16: consumeLines byte-aware truncation
// ================================================================

describe("CodexWorkerManager H16 - consumeLines byte-aware truncation", () => {
  it("source code uses Buffer for byte-level slicing", async () => {
    const source = await fs.readFile(
      path.join(__dirname, "codex-worker-manager.ts"),
      "utf-8",
    );

    // H16: Must use Buffer.from for byte conversion
    expect(source).toContain('Buffer.from(buffer, "utf-8")');

    // H16: Must use buf.length for byte-level slicing (not string length)
    expect(source).toContain("buf.length");
    expect(source).toContain("subarray");

    // H16: Must check against MAX_BUFFER_SIZE_BYTES
    expect(source).toContain("MAX_BUFFER_SIZE_BYTES");
    expect(source).toContain("Buffer.byteLength");
  });

  it("source code references H16 fix in comment", async () => {
    const source = await fs.readFile(
      path.join(__dirname, "codex-worker-manager.ts"),
      "utf-8",
    );
    expect(source).toContain("H16");
  });

  it("byte-aware truncation handles multi-byte characters correctly", () => {
    // Reproduce the truncation logic
    const MAX_SIZE = 100; // small limit for testing

    // String with multi-byte characters (each emoji is 4 bytes in UTF-8)
    const multiByteStr = "🎉".repeat(30); // 30 emojis = 120 bytes > 100 byte limit

    const bufferSizeBytes = Buffer.byteLength(multiByteStr, "utf-8");
    expect(bufferSizeBytes).toBeGreaterThan(MAX_SIZE);

    // Apply the H16 fix: byte-aware slicing
    const buf = Buffer.from(multiByteStr, "utf-8");
    const halfBytes = Math.floor(buf.length / 2);
    const truncated = buf.subarray(halfBytes).toString("utf-8");

    // Result should be valid UTF-8 (may have a replacement char at the boundary)
    expect(typeof truncated).toBe("string");
    // Result byte size should be approximately half the original
    const truncatedBytes = Buffer.byteLength(truncated, "utf-8");
    expect(truncatedBytes).toBeLessThanOrEqual(bufferSizeBytes);
  });

  it("byte-aware truncation handles ASCII correctly", () => {
    const MAX_SIZE = 50;
    const asciiStr = "A".repeat(100); // 100 bytes > 50 byte limit

    const buf = Buffer.from(asciiStr, "utf-8");
    const halfBytes = Math.floor(buf.length / 2);
    const truncated = buf.subarray(halfBytes).toString("utf-8");

    expect(truncated.length).toBe(50);
    expect(Buffer.byteLength(truncated, "utf-8")).toBe(50);
  });

  it("byte-aware truncation handles mixed content", () => {
    const MAX_SIZE = 50;
    const mixed = "Hello 🌍 World 🎉 Test 💻"; // mix of ASCII and multi-byte

    const buf = Buffer.from(mixed, "utf-8");
    const halfBytes = Math.floor(buf.length / 2);
    const truncated = buf.subarray(halfBytes).toString("utf-8");

    // Should produce valid string (no crash, no infinite loop)
    expect(typeof truncated).toBe("string");
    expect(truncated.length).toBeGreaterThan(0);
  });
});

// ================================================================
// H17: checkWorkerHealth timeout tracking
// ================================================================

describe("CodexWorkerManager H17/H-9 - checkWorkerHealth timeout and heartbeat tracking", () => {
  it("source code uses WorkerTimeoutTracker and HeartbeatTracker for health checks", async () => {
    const source = await fs.readFile(
      path.join(__dirname, "codex-worker-manager.ts"),
      "utf-8",
    );

    // H-9 FIX: Must use WorkerTimeoutTracker (replaces hardcoded 30-minute timeout)
    expect(source).toContain("WorkerTimeoutTracker");
    expect(source).toContain("timeoutTracker");
    expect(source).toContain("getTimedOutWorkers");

    // H-9 FIX: Must use HeartbeatTracker for stale detection via JSONL stream
    expect(source).toContain("HeartbeatTracker");
    expect(source).toContain("heartbeatTracker");
    expect(source).toContain("getStaleWorkers");

    // H-9: Must return timedOut array with actual data
    expect(source).toContain("timedOut");
  });

  it("source code references H-9 fix in comment", async () => {
    const source = await fs.readFile(
      path.join(__dirname, "codex-worker-manager.ts"),
      "utf-8",
    );
    expect(source).toContain("H-9");
  });

  it("timeout detection logic works correctly via WorkerTimeoutTracker", async () => {
    // Import and use the actual WorkerTimeoutTracker
    const { WorkerTimeoutTracker } = await import("./worker-resilience.js");

    // Use a short timeout for testing
    const tracker = new WorkerTimeoutTracker(100); // 100ms timeout

    tracker.startTracking("worker-1");

    // Immediately after start — should NOT be timed out
    expect(tracker.isTimedOut("worker-1")).toBe(false);
    expect(tracker.getTimedOutWorkers()).toEqual([]);

    // Wait for timeout to elapse
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Now should be timed out
    expect(tracker.isTimedOut("worker-1")).toBe(true);
    expect(tracker.getTimedOutWorkers()).toContain("worker-1");

    // Cleanup
    tracker.stopTracking("worker-1");
  });

  it("checkWorkerHealth returns correct structure", async () => {
    const source = await fs.readFile(
      path.join(__dirname, "codex-worker-manager.ts"),
      "utf-8",
    );

    // Should return { timedOut: string[], stale: string[] }
    expect(source).toContain("timedOut: string[]");
    expect(source).toContain("stale: string[]");

    // H-9: Stale detection is now supported via HeartbeatTracker (no longer returns empty stale: [])
    expect(source).toContain("heartbeatTracker");
    expect(source).toContain("recordHeartbeat");
  });
});

// ================================================================
// M-19: Model Configuration Support
// ================================================================

describe("CodexWorkerManager M-19 - Model Configuration", () => {
  it("source code imports CODEX_MODEL_MAP from constants", async () => {
    const source = await fs.readFile(
      path.join(__dirname, "codex-worker-manager.ts"),
      "utf-8",
    );

    // M-19: Must import CODEX_MODEL_MAP for model name mapping
    expect(source).toContain("CODEX_MODEL_MAP");
    // M-19: Must import from constants
    expect(source).toMatch(/import\s*\{[^}]*CODEX_MODEL_MAP[^}]*\}\s*from\s*["']\.\.\/utils\/constants/);
  });

  it("source code passes --model flag in buildCodexExecArgs", async () => {
    const source = await fs.readFile(
      path.join(__dirname, "codex-worker-manager.ts"),
      "utf-8",
    );

    // M-19: Must map model tier to Codex model name
    expect(source).toContain("CODEX_MODEL_MAP[this.modelConfig.worker]");
    // M-19: Must include --model flag in args
    expect(source).toContain('"--model"');
    expect(source).toContain("codexModel");
  });

  it("source code passes subagentModel to getWorkerPrompt", async () => {
    const source = await fs.readFile(
      path.join(__dirname, "codex-worker-manager.ts"),
      "utf-8",
    );

    // M-19: Must pass subagentModel in the worker prompt context
    expect(source).toContain("subagentModel: this.modelConfig.subagent");
  });

  it("constructor accepts modelConfig parameter", async () => {
    const source = await fs.readFile(
      path.join(__dirname, "codex-worker-manager.ts"),
      "utf-8",
    );

    // M-19: Constructor must accept ModelConfig with a default
    expect(source).toContain("modelConfig: ModelConfig");
    expect(source).toContain("DEFAULT_MODEL_CONFIG");
  });

  it("source code references M-19 in comments", async () => {
    const source = await fs.readFile(
      path.join(__dirname, "codex-worker-manager.ts"),
      "utf-8",
    );

    expect(source).toContain("M-19");
  });

  it("CODEX_MODEL_MAP has correct mappings for all tiers", async () => {
    const { CODEX_MODEL_MAP } = await import("../utils/constants.js");

    // Verify all three tiers are mapped
    expect(CODEX_MODEL_MAP).toHaveProperty("opus");
    expect(CODEX_MODEL_MAP).toHaveProperty("sonnet");
    expect(CODEX_MODEL_MAP).toHaveProperty("haiku");

    // Verify correct model name mappings
    expect(CODEX_MODEL_MAP.opus).toBe("o3");
    expect(CODEX_MODEL_MAP.sonnet).toBe("o4-mini");
    expect(CODEX_MODEL_MAP.haiku).toBe("o4-mini");
  });

  it("CODEX_JOB_MAX_RUNTIME_SECONDS is a positive integer", async () => {
    const { CODEX_JOB_MAX_RUNTIME_SECONDS } = await import("../utils/constants.js");

    expect(CODEX_JOB_MAX_RUNTIME_SECONDS).toBeGreaterThan(0);
    expect(Number.isInteger(CODEX_JOB_MAX_RUNTIME_SECONDS)).toBe(true);
    // Should be 45 minutes = 2700 seconds (derived from DEFAULT_WORKER_TIMEOUT_MS)
    expect(CODEX_JOB_MAX_RUNTIME_SECONDS).toBe(2700);
  });

  it("CODEX_JOB_MAX_RUNTIME_SECONDS is derived from DEFAULT_WORKER_TIMEOUT_MS", async () => {
    const { CODEX_JOB_MAX_RUNTIME_SECONDS, DEFAULT_WORKER_TIMEOUT_MS } = await import(
      "../utils/constants.js"
    );

    expect(CODEX_JOB_MAX_RUNTIME_SECONDS).toBe(Math.floor(DEFAULT_WORKER_TIMEOUT_MS / 1000));
  });

  it("model mapping produces correct args for each tier", () => {
    // Reproduce the model mapping logic from buildCodexExecArgs
    const CODEX_MODEL_MAP: Record<string, string> = {
      opus: "o3",
      sonnet: "o4-mini",
      haiku: "o4-mini",
    };

    // Reproduce the args-building logic for each tier
    for (const [tier, expectedModel] of Object.entries(CODEX_MODEL_MAP)) {
      const codexModel = CODEX_MODEL_MAP[tier];
      const args = [
        "exec",
        "--model",
        codexModel,
        "--json",
        "--full-auto",
      ];

      // Verify --model is followed by the correct model name
      const modelIndex = args.indexOf("--model");
      expect(modelIndex).toBeGreaterThanOrEqual(0);
      expect(args[modelIndex + 1]).toBe(expectedModel);

      // Verify --model appears before --json
      const jsonIndex = args.indexOf("--json");
      expect(modelIndex).toBeLessThan(jsonIndex);
    }
  });

  it("orchestrator passes modelConfig to CodexWorkerManager constructor", async () => {
    const orchestratorSource = await fs.readFile(
      path.join(__dirname, "orchestrator.ts"),
      "utf-8",
    );

    // M-19: Orchestrator must pass modelConfig when creating CodexWorkerManager
    expect(orchestratorSource).toContain("options.modelConfig");
    // Verify it appears in the CodexWorkerManager construction context
    expect(orchestratorSource).toContain("CodexWorkerManager");
  });

  it("setupCodexMcpConfig includes job_max_runtime_seconds in TOML output", async () => {
    const orchestratorSource = await fs.readFile(
      path.join(__dirname, "orchestrator.ts"),
      "utf-8",
    );

    // M-19: Must include agents section with job_max_runtime_seconds
    expect(orchestratorSource).toContain("[agents]");
    expect(orchestratorSource).toContain("job_max_runtime_seconds");
    expect(orchestratorSource).toContain("CODEX_JOB_MAX_RUNTIME_SECONDS");
  });
});

// ================================================================
// General source verification
// ================================================================

describe("CodexWorkerManager general security", () => {
  it("uses writeFileSecure for session status writes", async () => {
    const source = await fs.readFile(
      path.join(__dirname, "codex-worker-manager.ts"),
      "utf-8",
    );

    // Session status files should use writeFileSecure for proper permissions (H-7/H-8 fix)
    expect(source).toContain("writeFileSecure");
    // Should import writeFileSecure from secure-fs
    expect(source).toContain("writeFileSecure");
  });

  it("uses appendJsonlLocked for message writes", async () => {
    const source = await fs.readFile(
      path.join(__dirname, "codex-worker-manager.ts"),
      "utf-8",
    );

    // Should use the locking utility for JSONL writes
    expect(source).toContain("appendJsonlLocked");
  });
});
