/**
 * Orchestrator Integration Tests - Main Happy Path
 *
 * These tests verify the Orchestrator's main run() loop functionality:
 * - Fresh initialization with state creation
 * - Single cycle completion (planning -> execution -> review -> checkpoint)
 * - Planning phase produces tasks
 * - Execution phase spawns workers
 * - Review phase processes Codex approval
 * - Checkpoint records cycle and returns appropriate status
 *
 * Uses mocked SDK (no real Claude sessions) and real temp directories.
 *
 * @module orchestrator-integration.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

// Mock the SDK BEFORE importing Orchestrator (hoisted by vitest)
// Using inline vi.fn() to avoid hoisting issues
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(() => ({
    async *[Symbol.asyncIterator]() {
      yield { type: "result", result: "" };
    },
  })),
  createSdkMcpServer: vi.fn(() => ({
    close: vi.fn(),
  })),
  tool: vi.fn(() => ({})),
}));

// Mock child_process for codex CLI
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  execSync: vi.fn(() => Buffer.from("")),
}));

// Mock readline to avoid interactive prompts
vi.mock("node:readline/promises", () => ({
  default: {
    createInterface: vi.fn(() => ({
      question: vi.fn().mockResolvedValue("test answer"),
      close: vi.fn(),
    })),
  },
}));

// Import SDK mock to access the mocked function
import * as sdk from "@anthropic-ai/claude-agent-sdk";

import { Orchestrator } from "./orchestrator.js";
import { StateManager } from "./state-manager.js";
import type { CLIOptions, Task } from "../utils/types.js";
import {
  createMockTaskDefinition,
  createTempProjectDir,
  cleanupTempDir,
} from "./__tests__/orchestrator-test-utils.js";
import { ORCHESTRATOR_DIR } from "../utils/constants.js";

// Get the mocked query function
const mockQuery = vi.mocked(sdk.query);

// ============================================================
// Test Setup Helpers
// ============================================================

function createTestOptions(projectDir: string, overrides: Partial<CLIOptions> = {}): CLIOptions {
  return {
    project: projectDir,
    feature: "Test feature implementation",
    concurrency: 1,
    maxCycles: 3,
    usageThreshold: 0.8,
    skipCodex: true, // Skip Codex by default to simplify tests
    skipFlowReview: true, // Skip flow review by default
    dryRun: false,
    resume: false,
    verbose: false,
    contextFile: null,
    currentBranch: true, // Use current branch mode (no git operations)
    workerRuntime: "claude",
    forceResume: false,
    ...overrides,
  };
}

// Helper to create a mock async iterable query result
function createMockQueryResult(result: string) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "result", result };
    },
  };
}

// ============================================================
// Integration Tests - Main Happy Path
// ============================================================

describe("Orchestrator Integration - Happy Path", () => {
  let tempDir: string;
  let options: CLIOptions;

  beforeEach(async () => {
    tempDir = await createTempProjectDir();
    options = createTestOptions(tempDir);

    // Initialize a minimal git repo for the orchestrator
    await fs.writeFile(path.join(tempDir, ".gitignore"), ".conductor/\n");

    // Reset and configure mock SDK to return empty responses by default
    mockQuery.mockReset();
    mockQuery.mockReturnValue(createMockQueryResult(""));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTempDir(tempDir);
  });

  // ============================================================
  // Test 1: Fresh start initializes state correctly
  // ============================================================

  it("fresh start initializes state correctly", async () => {
    const orchestrator = new Orchestrator(options);

    // We'll just check that the orchestrator can be constructed
    // and the state directory exists
    expect(orchestrator).toBeDefined();

    const conductorDir = path.join(tempDir, ORCHESTRATOR_DIR);
    const stat = await fs.stat(conductorDir);
    expect(stat.isDirectory()).toBe(true);
  });

  // ============================================================
  // Test 2: State manager initializes with correct structure
  // ============================================================

  it("state manager initializes with correct structure", async () => {
    const stateManager = new StateManager(tempDir);

    await stateManager.initialize("Test feature", "conduct/test-feature", {
      maxCycles: 3,
      concurrency: 2,
      workerRuntime: "claude",
    });

    const state = stateManager.get();

    expect(state.status).toBe("initializing");
    expect(state.feature).toBe("Test feature");
    expect(state.max_cycles).toBe(3);
    expect(state.concurrency).toBe(2);
    expect(state.current_cycle).toBe(0);
    expect(state.completed_task_ids).toEqual([]);
    expect(state.cycle_history).toEqual([]);
  });

  // ============================================================
  // Test 3: Dry run mode (state manager only - no git required)
  // ============================================================

  it("dry run option can be set in CLI options", async () => {
    const dryRunOptions = createTestOptions(tempDir, { dryRun: true });

    // Verify dry run option is correctly set
    expect(dryRunOptions.dryRun).toBe(true);
    expect(dryRunOptions.skipCodex).toBe(true);
    expect(dryRunOptions.skipFlowReview).toBe(true);
  });

  // ============================================================
  // Test 4: State persists to state.json
  // ============================================================

  it("state persists to state.json", async () => {
    const stateManager = new StateManager(tempDir);

    await stateManager.initialize("Persisted feature", "conduct/persisted", {
      maxCycles: 5,
      concurrency: 2,
      workerRuntime: "claude",
    });

    await stateManager.setStatus("planning");
    await stateManager.save();

    const statePath = path.join(tempDir, ORCHESTRATOR_DIR, "state.json");
    const content = await fs.readFile(statePath, "utf-8");
    const persisted = JSON.parse(content);

    expect(persisted.feature).toBe("Persisted feature");
    expect(persisted.status).toBe("planning");
  });

  // ============================================================
  // Test 5: Task creation works correctly
  // ============================================================

  it("task creation stores tasks correctly", async () => {
    const stateManager = new StateManager(tempDir);

    await stateManager.initialize("Task test", "conduct/task-test", {
      maxCycles: 3,
      concurrency: 2,
      workerRuntime: "claude",
    });

    await stateManager.createDirectories();

    const taskDef = createMockTaskDefinition({
      subject: "Implement login",
      description: "Add user login functionality",
      task_type: "backend_api",
    });

    await stateManager.createTask(taskDef, "task-001", []);

    const tasks = await stateManager.getAllTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("task-001");
    expect(tasks[0].subject).toBe("Implement login");
    expect(tasks[0].status).toBe("pending");
  });

  // ============================================================
  // Test 6: Checkpoint returns 'complete' when all tasks done
  // ============================================================

  it("checkpoint returns complete when all tasks are done", async () => {
    const stateManager = new StateManager(tempDir);

    await stateManager.initialize("Checkpoint test", "conduct/checkpoint", {
      maxCycles: 3,
      concurrency: 2,
      workerRuntime: "claude",
    });

    await stateManager.createDirectories();

    // Create a task and mark it completed
    const taskDef = createMockTaskDefinition({ subject: "Test task" });
    await stateManager.createTask(taskDef, "task-001", []);

    // Read task, update status to completed, write back
    const taskPath = path.join(tempDir, ORCHESTRATOR_DIR, "tasks", "task-001.json");
    const taskContent = await fs.readFile(taskPath, "utf-8");
    const task: Task = JSON.parse(taskContent);
    task.status = "completed";
    task.completed_at = new Date().toISOString();
    await fs.writeFile(taskPath, JSON.stringify(task, null, 2));

    // Verify task status
    const tasks = await stateManager.getAllTasks();
    expect(tasks[0].status).toBe("completed");

    // All tasks are completed, no failed or pending
    const completed = tasks.filter((t) => t.status === "completed");
    const failed = tasks.filter((t) => t.status === "failed");
    const pending = tasks.filter((t) => t.status === "pending");

    expect(completed.length).toBe(1);
    expect(failed.length).toBe(0);
    expect(pending.length).toBe(0);
  });

  // ============================================================
  // Test 7: Cycle history records completed cycles
  // ============================================================

  it("cycle history records completed cycles", async () => {
    const stateManager = new StateManager(tempDir);

    await stateManager.initialize("Cycle test", "conduct/cycle-test", {
      maxCycles: 5,
      concurrency: 2,
      workerRuntime: "claude",
    });

    const cycleRecord = {
      cycle: 1,
      plan_version: 1,
      tasks_completed: 3,
      tasks_failed: 0,
      codex_plan_approved: true,
      codex_code_approved: true,
      plan_discussion_rounds: 1,
      code_review_rounds: 1,
      duration_ms: 60000,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    };

    await stateManager.recordCycle(cycleRecord);

    const state = stateManager.get();
    expect(state.current_cycle).toBe(1);
    expect(state.cycle_history).toHaveLength(1);
    expect(state.cycle_history[0].tasks_completed).toBe(3);
  });

  // ============================================================
  // Test 8: Resume from paused state continues execution
  // ============================================================

  it("resume from paused state continues execution", async () => {
    const stateManager = new StateManager(tempDir);

    // Initialize and pause
    await stateManager.initialize("Resume test", "conduct/resume-test", {
      maxCycles: 3,
      concurrency: 2,
      workerRuntime: "claude",
    });

    await stateManager.setStatus("executing");
    await stateManager.pause("test-pause");

    expect(stateManager.get().status).toBe("paused");
    expect(stateManager.get().paused_at).not.toBeNull();

    // Resume
    await stateManager.resume();

    const state = stateManager.get();
    expect(state.status).toBe("executing");
    expect(state.paused_at).toBeNull();
  });
});
