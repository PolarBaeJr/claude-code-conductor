import { describe, expect, it } from "vitest";
import {
  computeCriticalPathDepths,
  detectCycles,
  scoreTask,
  isTaskClaimable,
  rankClaimableTasks,
  rankAllTasks,
} from "./task-scheduler.js";
import type { Task, TaskType } from "../utils/types.js";

/**
 * Creates a minimal Task for testing.
 */
function makeTask(
  id: string,
  depends_on: string[] = [],
  overrides: Partial<Task> = {}
): Task {
  return {
    id,
    subject: `Task ${id}`,
    description: "Test task",
    status: "pending",
    owner: null,
    depends_on,
    blocks: [],
    result_summary: null,
    files_changed: [],
    created_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}

// ============================================================
// computeCriticalPathDepths Tests
// ============================================================

describe("computeCriticalPathDepths", () => {
  it("computes correct depths for linear chain A <- B <- C", () => {
    // A has no dependencies
    // B depends on A (so A blocks B)
    // C depends on B (so B blocks C)
    const tasks = [
      makeTask("A"),
      makeTask("B", ["A"]),
      makeTask("C", ["B"]),
    ];

    const depths = computeCriticalPathDepths(tasks);

    // A blocks B which blocks C, so A has depth 2
    expect(depths.get("A")).toBe(2);
    // B blocks C, so B has depth 1
    expect(depths.get("B")).toBe(1);
    // C blocks nothing, so C has depth 0
    expect(depths.get("C")).toBe(0);
  });

  it("computes correct depths for diamond dependency", () => {
    // Diamond: A <- B, A <- C, B <- D, C <- D
    // A blocks B and C
    // B blocks D
    // C blocks D
    const tasks = [
      makeTask("A"),
      makeTask("B", ["A"]),
      makeTask("C", ["A"]),
      makeTask("D", ["B", "C"]),
    ];

    const depths = computeCriticalPathDepths(tasks);

    // A -> B/C -> D, so A has depth 2
    expect(depths.get("A")).toBe(2);
    // B -> D, so B has depth 1
    expect(depths.get("B")).toBe(1);
    // C -> D, so C has depth 1
    expect(depths.get("C")).toBe(1);
    // D blocks nothing
    expect(depths.get("D")).toBe(0);
  });

  it("returns depth 0 for isolated tasks", () => {
    const tasks = [makeTask("A"), makeTask("B"), makeTask("C")];

    const depths = computeCriticalPathDepths(tasks);

    expect(depths.get("A")).toBe(0);
    expect(depths.get("B")).toBe(0);
    expect(depths.get("C")).toBe(0);
  });

  it("handles cycles gracefully without infinite loops", () => {
    // Cycle: A depends on B, B depends on A
    const tasks = [makeTask("A", ["B"]), makeTask("B", ["A"])];

    // Should not throw
    expect(() => computeCriticalPathDepths(tasks)).not.toThrow();

    const depths = computeCriticalPathDepths(tasks);

    // Should return some valid numbers (implementation breaks cycle)
    expect(typeof depths.get("A")).toBe("number");
    expect(typeof depths.get("B")).toBe("number");
  });

  it("handles self-referential dependencies", () => {
    // A depends on itself
    const tasks = [makeTask("A", ["A"])];

    // Should not throw
    expect(() => computeCriticalPathDepths(tasks)).not.toThrow();

    const depths = computeCriticalPathDepths(tasks);
    expect(typeof depths.get("A")).toBe("number");
  });

  it("handles missing dependencies gracefully", () => {
    // B depends on X which doesn't exist
    const tasks = [makeTask("A"), makeTask("B", ["X"])];

    // Should not throw
    expect(() => computeCriticalPathDepths(tasks)).not.toThrow();

    const depths = computeCriticalPathDepths(tasks);
    expect(depths.get("A")).toBe(0);
    expect(depths.get("B")).toBe(0);
  });

  it("computes correct depths for complex graph", () => {
    // Complex graph:
    // A <- B <- D
    // A <- C <- D
    // B <- E
    // C <- E
    const tasks = [
      makeTask("A"),
      makeTask("B", ["A"]),
      makeTask("C", ["A"]),
      makeTask("D", ["B", "C"]),
      makeTask("E", ["B", "C"]),
    ];

    const depths = computeCriticalPathDepths(tasks);

    // A blocks B and C, which block D and E
    expect(depths.get("A")).toBe(2);
    expect(depths.get("B")).toBe(1);
    expect(depths.get("C")).toBe(1);
    expect(depths.get("D")).toBe(0);
    expect(depths.get("E")).toBe(0);
  });

  it("handles empty task list", () => {
    const depths = computeCriticalPathDepths([]);
    expect(depths.size).toBe(0);
  });

  it("handles single task", () => {
    const tasks = [makeTask("A")];
    const depths = computeCriticalPathDepths(tasks);
    expect(depths.get("A")).toBe(0);
  });
});

// ============================================================
// detectCycles Tests
// ============================================================

describe("detectCycles", () => {
  it("returns empty array for acyclic graph", () => {
    const tasks = [
      makeTask("A"),
      makeTask("B", ["A"]),
      makeTask("C", ["B"]),
    ];

    const cycles = detectCycles(tasks);
    expect(cycles).toEqual([]);
  });

  it("detects simple two-node cycle", () => {
    const tasks = [makeTask("A", ["B"]), makeTask("B", ["A"])];

    const cycles = detectCycles(tasks);
    expect(cycles.length).toBeGreaterThan(0);
  });

  it("detects self-referential cycle", () => {
    const tasks = [makeTask("A", ["A"])];

    const cycles = detectCycles(tasks);
    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles[0]).toContain("A");
  });

  it("returns empty for empty task list", () => {
    const cycles = detectCycles([]);
    expect(cycles).toEqual([]);
  });

  it("handles missing dependency references", () => {
    // B depends on X which doesn't exist
    const tasks = [makeTask("A"), makeTask("B", ["X"])];

    // Should not throw
    expect(() => detectCycles(tasks)).not.toThrow();
    const cycles = detectCycles(tasks);
    expect(cycles).toEqual([]);
  });
});

// ============================================================
// scoreTask Tests
// ============================================================

describe("scoreTask", () => {
  it("applies correct formula: (depth * 10) + riskScore + typeScore", () => {
    const task = makeTask("A", [], {
      task_type: "security",
      risk_level: "high",
    });

    // security = 60, high = 30, depth 2 = 20
    const score = scoreTask(task, 2);
    expect(score).toBe(20 + 30 + 60); // 110
  });

  it("uses defaults for missing task_type and risk_level", () => {
    const task = makeTask("A");
    const score = scoreTask(task, 0);
    // depth 0, general = 0, low = 0
    expect(score).toBe(0);
  });

  it("computes correct score for database task with medium risk", () => {
    const task = makeTask("A", [], {
      task_type: "database",
      risk_level: "medium",
    });

    // database = 50, medium = 15, depth 1 = 10
    const score = scoreTask(task, 1);
    expect(score).toBe(10 + 15 + 50); // 75
  });

  it("computes correct score for frontend task with low risk", () => {
    const task = makeTask("A", [], {
      task_type: "frontend_ui",
      risk_level: "low",
    });

    // frontend_ui = 20, low = 0, depth 0 = 0
    const score = scoreTask(task, 0);
    expect(score).toBe(0 + 0 + 20); // 20
  });

  it("computes correct score for testing task", () => {
    const task = makeTask("A", [], {
      task_type: "testing",
      risk_level: "low",
    });

    // testing = 10, low = 0, depth 3 = 30
    const score = scoreTask(task, 3);
    expect(score).toBe(30 + 0 + 10); // 40
  });

  it("critical path depth dominates scoring", () => {
    const lowPriorityDeepTask = makeTask("A", [], {
      task_type: "general",
      risk_level: "low",
    });

    const highPriorityShallowTask = makeTask("B", [], {
      task_type: "security",
      risk_level: "high",
    });

    // Deep task: depth 10 = 100, general = 0, low = 0 -> 100
    const deepScore = scoreTask(lowPriorityDeepTask, 10);
    // Shallow task: depth 0 = 0, security = 60, high = 30 -> 90
    const shallowScore = scoreTask(highPriorityShallowTask, 0);

    expect(deepScore).toBeGreaterThan(shallowScore);
  });
});

// ============================================================
// isTaskClaimable Tests
// ============================================================

describe("isTaskClaimable", () => {
  it("returns true for pending task with no dependencies", () => {
    const task = makeTask("A");
    const allTasks = [task];

    expect(isTaskClaimable(task, allTasks)).toBe(true);
  });

  it("returns true for pending task with completed dependencies", () => {
    const taskA = makeTask("A", [], { status: "completed" });
    const taskB = makeTask("B", ["A"]);
    const allTasks = [taskA, taskB];

    expect(isTaskClaimable(taskB, allTasks)).toBe(true);
  });

  it("returns false for pending task with pending dependencies", () => {
    const taskA = makeTask("A");
    const taskB = makeTask("B", ["A"]);
    const allTasks = [taskA, taskB];

    expect(isTaskClaimable(taskB, allTasks)).toBe(false);
  });

  it("returns false for pending task with in_progress dependencies", () => {
    const taskA = makeTask("A", [], { status: "in_progress" });
    const taskB = makeTask("B", ["A"]);
    const allTasks = [taskA, taskB];

    expect(isTaskClaimable(taskB, allTasks)).toBe(false);
  });

  it("returns false for in_progress task", () => {
    const task = makeTask("A", [], { status: "in_progress" });
    const allTasks = [task];

    expect(isTaskClaimable(task, allTasks)).toBe(false);
  });

  it("returns false for completed task", () => {
    const task = makeTask("A", [], { status: "completed" });
    const allTasks = [task];

    expect(isTaskClaimable(task, allTasks)).toBe(false);
  });

  it("returns false for failed task", () => {
    const task = makeTask("A", [], { status: "failed" });
    const allTasks = [task];

    expect(isTaskClaimable(task, allTasks)).toBe(false);
  });

  it("returns false for task with missing dependency", () => {
    // B depends on X which doesn't exist
    const taskB = makeTask("B", ["X"]);
    const allTasks = [taskB];

    expect(isTaskClaimable(taskB, allTasks)).toBe(false);
  });

  it("handles multiple dependencies correctly", () => {
    const taskA = makeTask("A", [], { status: "completed" });
    const taskB = makeTask("B", [], { status: "completed" });
    const taskC = makeTask("C", ["A", "B"]);
    const allTasks = [taskA, taskB, taskC];

    expect(isTaskClaimable(taskC, allTasks)).toBe(true);
  });

  it("returns false if any dependency is not completed", () => {
    const taskA = makeTask("A", [], { status: "completed" });
    const taskB = makeTask("B", [], { status: "pending" });
    const taskC = makeTask("C", ["A", "B"]);
    const allTasks = [taskA, taskB, taskC];

    expect(isTaskClaimable(taskC, allTasks)).toBe(false);
  });
});

// ============================================================
// rankClaimableTasks Tests
// ============================================================

describe("rankClaimableTasks", () => {
  it("returns only pending tasks with completed dependencies", () => {
    const tasks = [
      makeTask("A", [], { status: "completed" }),
      makeTask("B", ["A"], { status: "pending" }),
      makeTask("C", ["A"], { status: "in_progress" }),
      makeTask("D", ["B"], { status: "pending" }), // blocked by B which is pending
    ];

    const ranked = rankClaimableTasks(tasks);

    expect(ranked.length).toBe(1);
    expect(ranked[0].id).toBe("B");
  });

  it("sorts by priority score descending", () => {
    const tasks = [
      makeTask("A", [], { task_type: "general", risk_level: "low" }),
      makeTask("B", [], { task_type: "security", risk_level: "high" }),
      makeTask("C", [], { task_type: "database", risk_level: "medium" }),
    ];

    const ranked = rankClaimableTasks(tasks);

    // B: security(60) + high(30) = 90
    // C: database(50) + medium(15) = 65
    // A: general(0) + low(0) = 0
    expect(ranked[0].id).toBe("B");
    expect(ranked[1].id).toBe("C");
    expect(ranked[2].id).toBe("A");
  });

  it("includes priority_score and critical_path_depth in results", () => {
    const tasks = [makeTask("A", [], { task_type: "security" })];

    const ranked = rankClaimableTasks(tasks);

    expect(ranked[0]).toHaveProperty("priority_score");
    expect(ranked[0]).toHaveProperty("critical_path_depth");
    expect(ranked[0].priority_score).toBe(60); // security = 60, depth 0, low risk = 0
    expect(ranked[0].critical_path_depth).toBe(0);
  });

  it("returns empty array when no tasks are claimable", () => {
    const tasks = [
      makeTask("A", [], { status: "in_progress" }),
      makeTask("B", ["A"], { status: "pending" }),
    ];

    const ranked = rankClaimableTasks(tasks);
    expect(ranked).toEqual([]);
  });

  it("handles empty task list", () => {
    const ranked = rankClaimableTasks([]);
    expect(ranked).toEqual([]);
  });

  it("considers critical path depth in ranking", () => {
    // A blocks B and C
    // B, C block D
    // All are claimable (no dependencies)
    const tasks = [
      makeTask("A"),
      makeTask("B", ["A"], { status: "completed" }),
      makeTask("C", ["A"], { status: "completed" }),
      makeTask("D", ["B", "C"], { status: "pending" }),
    ];

    // Only A is claimable since B and C depend on A
    // But A is completed, so update:
    tasks[0].status = "pending";
    tasks[1].status = "pending";
    tasks[2].status = "pending";
    tasks[3].status = "pending";

    // Now only A is claimable
    const ranked = rankClaimableTasks(tasks);
    expect(ranked.length).toBe(1);
    expect(ranked[0].id).toBe("A");
    // A has critical_path_depth = 2 (A -> B/C -> D)
    expect(ranked[0].critical_path_depth).toBe(2);
    expect(ranked[0].priority_score).toBe(20); // depth 2 * 10 = 20
  });
});

// ============================================================
// rankAllTasks Tests
// ============================================================

describe("rankAllTasks", () => {
  it("returns all tasks regardless of status", () => {
    const tasks = [
      makeTask("A", [], { status: "completed" }),
      makeTask("B", [], { status: "pending" }),
      makeTask("C", [], { status: "in_progress" }),
      makeTask("D", [], { status: "failed" }),
    ];

    const ranked = rankAllTasks(tasks);
    expect(ranked.length).toBe(4);
  });

  it("sorts all tasks by priority score descending", () => {
    const tasks = [
      makeTask("A", [], { task_type: "general", status: "completed" }),
      makeTask("B", [], { task_type: "security", status: "in_progress" }),
      makeTask("C", [], { task_type: "database", status: "pending" }),
    ];

    const ranked = rankAllTasks(tasks);

    expect(ranked[0].id).toBe("B"); // security = 60
    expect(ranked[1].id).toBe("C"); // database = 50
    expect(ranked[2].id).toBe("A"); // general = 0
  });

  it("includes priority_score and critical_path_depth for all tasks", () => {
    const tasks = [
      makeTask("A"),
      makeTask("B", ["A"]),
    ];

    const ranked = rankAllTasks(tasks);

    for (const task of ranked) {
      expect(task).toHaveProperty("priority_score");
      expect(task).toHaveProperty("critical_path_depth");
      expect(typeof task.priority_score).toBe("number");
      expect(typeof task.critical_path_depth).toBe("number");
    }
  });

  it("handles empty task list", () => {
    const ranked = rankAllTasks([]);
    expect(ranked).toEqual([]);
  });
});
