/**
 * Integration tests for EventLog module.
 *
 * These tests use real file system operations in temp directories to verify
 * the roundtrip behavior of recording, flushing, and reading events.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  EventLog,
  computeAnalytics,
  formatAnalyticsForDisplay,
} from "./event-log.js";
import type { StructuredEvent } from "../utils/types.js";
import { ORCHESTRATOR_DIR, EVENTS_FILE } from "../utils/constants.js";

describe("EventLog integration", () => {
  let tempDir: string;
  let eventLog: EventLog;

  beforeEach(async () => {
    // Create temp directory for test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "conductor-test-"));

    // Create .conductor directory structure
    await fs.mkdir(path.join(tempDir, ORCHESTRATOR_DIR), { recursive: true });

    eventLog = new EventLog(tempDir);
  });

  afterEach(async () => {
    // Stop event log if running
    if (eventLog.isRunning()) {
      await eventLog.stop();
    }

    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("record -> flush -> readAll roundtrip", () => {
    it("writes and reads back events correctly", async () => {
      eventLog.start();

      // Record some events
      eventLog.record({ type: "phase_start", phase: "test" });
      eventLog.record({ type: "worker_spawn", session_id: "worker-1" });
      eventLog.record({ type: "phase_end", phase: "test", duration_ms: 1000 });

      // Manually flush
      await eventLog.flush();

      // Read back
      const events = await eventLog.readAll();

      expect(events.length).toBe(3);
      expect(events[0].type).toBe("phase_start");
      expect(events[1].type).toBe("worker_spawn");
      expect(events[2].type).toBe("phase_end");
    });

    it("preserves event data on roundtrip", async () => {
      eventLog.start();

      // Record a complex event
      eventLog.record({
        type: "task_completed",
        task_id: "task-123",
        session_id: "worker-456",
      });

      await eventLog.flush();
      const events = await eventLog.readAll();

      expect(events.length).toBe(1);
      const event = events[0] as Extract<
        StructuredEvent,
        { type: "task_completed" }
      >;
      expect(event.type).toBe("task_completed");
      expect(event.task_id).toBe("task-123");
      expect(event.session_id).toBe("worker-456");
      expect(event.timestamp).toBeDefined();
    });

    it("auto-generates timestamp if not provided", async () => {
      eventLog.start();

      const beforeRecord = new Date().toISOString();
      eventLog.record({ type: "phase_start", phase: "timing-test" });
      const afterRecord = new Date().toISOString();

      await eventLog.flush();
      const events = await eventLog.readAll();

      expect(events.length).toBe(1);
      const timestamp = events[0].timestamp;
      expect(timestamp >= beforeRecord).toBe(true);
      expect(timestamp <= afterRecord).toBe(true);
    });

    it("uses provided timestamp if given", async () => {
      eventLog.start();

      const customTimestamp = "2020-01-01T00:00:00.000Z";
      eventLog.record({
        type: "phase_start",
        phase: "custom-time",
        timestamp: customTimestamp,
      });

      await eventLog.flush();
      const events = await eventLog.readAll();

      expect(events.length).toBe(1);
      expect(events[0].timestamp).toBe(customTimestamp);
    });
  });

  describe("buffering behavior", () => {
    it("buffers multiple records before flush", async () => {
      eventLog.start();

      // Record without flushing
      for (let i = 0; i < 10; i++) {
        eventLog.record({ type: "usage_warning", utilization: i / 10 });
      }

      // Buffer should have 10 items
      expect(eventLog.getBufferSize()).toBe(10);

      // Before flush, file should not exist or be empty
      const eventsPath = path.join(tempDir, ORCHESTRATOR_DIR, EVENTS_FILE);
      let existsBefore = false;
      try {
        await fs.access(eventsPath);
        const content = await fs.readFile(eventsPath, "utf-8");
        existsBefore = content.length > 0;
      } catch {
        existsBefore = false;
      }
      expect(existsBefore).toBe(false);

      // Flush
      await eventLog.flush();

      // Buffer should be empty now
      expect(eventLog.getBufferSize()).toBe(0);

      // After flush, all events should be in file
      const events = await eventLog.readAll();
      expect(events.length).toBe(10);
    });

    it("flush is idempotent on empty buffer", async () => {
      eventLog.start();

      // Flush with empty buffer - should not throw
      await eventLog.flush();
      await eventLog.flush();
      await eventLog.flush();

      const events = await eventLog.readAll();
      expect(events.length).toBe(0);
    });

    it("clears buffer after successful flush", async () => {
      eventLog.start();

      eventLog.record({ type: "phase_start", phase: "clear-test" });
      expect(eventLog.getBufferSize()).toBe(1);

      await eventLog.flush();
      expect(eventLog.getBufferSize()).toBe(0);
    });
  });

  describe("appending behavior", () => {
    it("appends to existing log file", async () => {
      eventLog.start();

      // First batch
      eventLog.record({ type: "phase_start", phase: "batch1" });
      await eventLog.flush();

      // Second batch
      eventLog.record({ type: "phase_start", phase: "batch2" });
      await eventLog.flush();

      const events = await eventLog.readAll();
      expect(events.length).toBe(2);
      expect((events[0] as Extract<StructuredEvent, { type: "phase_start" }>).phase).toBe(
        "batch1"
      );
      expect((events[1] as Extract<StructuredEvent, { type: "phase_start" }>).phase).toBe(
        "batch2"
      );
    });

    it("maintains order across multiple flushes", async () => {
      eventLog.start();

      // Record and flush in sequence
      for (let i = 0; i < 5; i++) {
        eventLog.record({ type: "usage_warning", utilization: i });
        await eventLog.flush();
      }

      const events = await eventLog.readAll();
      expect(events.length).toBe(5);

      // Verify order
      for (let i = 0; i < 5; i++) {
        const event = events[i] as Extract<
          StructuredEvent,
          { type: "usage_warning" }
        >;
        expect(event.utilization).toBe(i);
      }
    });
  });

  describe("missing file handling", () => {
    it("readAll handles missing file gracefully", async () => {
      // Don't record anything, try to read
      const events = await eventLog.readAll();
      expect(events).toEqual([]);
    });

    it("readAll handles missing .conductor directory gracefully", async () => {
      // Remove .conductor directory
      await fs.rm(path.join(tempDir, ORCHESTRATOR_DIR), {
        recursive: true,
        force: true,
      });

      const events = await eventLog.readAll();
      expect(events).toEqual([]);
    });

    it("creates .conductor directory if missing on flush", async () => {
      // Remove .conductor directory
      await fs.rm(path.join(tempDir, ORCHESTRATOR_DIR), {
        recursive: true,
        force: true,
      });

      eventLog.start();
      eventLog.record({ type: "phase_start", phase: "mkdir-test" });
      await eventLog.flush();

      // Directory should now exist
      const dirExists = await fs
        .access(path.join(tempDir, ORCHESTRATOR_DIR))
        .then(() => true)
        .catch(() => false);
      expect(dirExists).toBe(true);

      const events = await eventLog.readAll();
      expect(events.length).toBe(1);
    });
  });

  describe("corrupted line handling", () => {
    it("skips corrupted JSON lines gracefully", async () => {
      eventLog.start();

      // Write some valid events
      eventLog.record({ type: "phase_start", phase: "valid1" });
      await eventLog.flush();

      // Manually append corrupted line
      const eventsPath = path.join(tempDir, ORCHESTRATOR_DIR, EVENTS_FILE);
      await fs.appendFile(eventsPath, "this is not json\n", "utf-8");

      // Write another valid event
      eventLog.record({ type: "phase_start", phase: "valid2" });
      await eventLog.flush();

      // Read should skip corrupted line
      const events = await eventLog.readAll();
      expect(events.length).toBe(2);
      expect((events[0] as Extract<StructuredEvent, { type: "phase_start" }>).phase).toBe(
        "valid1"
      );
      expect((events[1] as Extract<StructuredEvent, { type: "phase_start" }>).phase).toBe(
        "valid2"
      );
    });

    it("skips events without required fields", async () => {
      eventLog.start();

      // Write a valid event
      eventLog.record({ type: "phase_start", phase: "valid" });
      await eventLog.flush();

      // Manually append malformed events (missing required fields)
      const eventsPath = path.join(tempDir, ORCHESTRATOR_DIR, EVENTS_FILE);
      await fs.appendFile(
        eventsPath,
        '{"phase":"no-type"}\n',
        "utf-8"
      );
      await fs.appendFile(
        eventsPath,
        '{"type":"phase_start"}\n', // Missing timestamp
        "utf-8"
      );

      const events = await eventLog.readAll();
      expect(events.length).toBe(1);
      expect((events[0] as Extract<StructuredEvent, { type: "phase_start" }>).phase).toBe(
        "valid"
      );
    });
  });

  describe("analytics computation", () => {
    it("computes phase durations correctly", async () => {
      eventLog.start();

      // Record phases with known durations
      eventLog.record({ type: "phase_start", phase: "test" });
      eventLog.record({ type: "phase_end", phase: "test", duration_ms: 5000 });
      eventLog.record({ type: "phase_start", phase: "test" });
      eventLog.record({ type: "phase_end", phase: "test", duration_ms: 3000 });

      await eventLog.flush();

      const analytics = await eventLog.getAnalytics();

      expect(analytics.phase_durations["test"]).toBeDefined();
      expect(analytics.phase_durations["test"].avg_ms).toBe(4000);
      expect(analytics.phase_durations["test"].count).toBe(2);
    });

    it("computes worker success rate correctly", async () => {
      eventLog.start();

      eventLog.record({
        type: "worker_complete",
        session_id: "w1",
        tasks_completed: 3,
      });
      eventLog.record({
        type: "worker_complete",
        session_id: "w2",
        tasks_completed: 2,
      });
      eventLog.record({
        type: "worker_fail",
        session_id: "w3",
        error: "timeout",
      });

      await eventLog.flush();

      const analytics = await eventLog.getAnalytics();

      // 2 success, 1 fail = 66.7% rounded to 67%
      expect(analytics.worker_success_rate).toBe(67);
    });

    it("handles worker_timeout as failure", async () => {
      eventLog.start();

      eventLog.record({
        type: "worker_complete",
        session_id: "w1",
        tasks_completed: 1,
      });
      eventLog.record({
        type: "worker_timeout",
        session_id: "w2",
        duration_ms: 3000000,
      });

      await eventLog.flush();

      const analytics = await eventLog.getAnalytics();

      // 1 success, 1 fail = 50%
      expect(analytics.worker_success_rate).toBe(50);
    });

    it("computes task retry rate correctly", async () => {
      eventLog.start();

      // 3 completed, 1 retried
      eventLog.record({
        type: "task_completed",
        task_id: "t1",
        session_id: "w1",
      });
      eventLog.record({
        type: "task_completed",
        task_id: "t2",
        session_id: "w1",
      });
      eventLog.record({
        type: "task_completed",
        task_id: "t3",
        session_id: "w1",
      });
      eventLog.record({ type: "task_retried", task_id: "t4", retry_count: 1 });

      await eventLog.flush();

      const analytics = await eventLog.getAnalytics();

      // 1 retry out of 4 outcomes = 25%
      expect(analytics.task_retry_rate).toBe(25);
    });

    it("tracks total events, workers, and tasks", async () => {
      eventLog.start();

      eventLog.record({ type: "worker_spawn", session_id: "w1" });
      eventLog.record({ type: "worker_spawn", session_id: "w2" });
      eventLog.record({ type: "worker_spawn", session_id: "w3" });
      eventLog.record({
        type: "task_completed",
        task_id: "t1",
        session_id: "w1",
      });
      eventLog.record({
        type: "task_completed",
        task_id: "t2",
        session_id: "w2",
      });
      eventLog.record({ type: "phase_start", phase: "test" });

      await eventLog.flush();

      const analytics = await eventLog.getAnalytics();

      expect(analytics.total_events).toBe(6);
      expect(analytics.total_workers).toBe(3);
      expect(analytics.total_tasks_completed).toBe(2);
    });

    it("computes top bottleneck tasks", async () => {
      eventLog.start();

      // Claim and complete tasks with varying durations
      const baseTime = Date.now();

      eventLog.record({
        type: "task_claimed",
        task_id: "fast-task",
        session_id: "w1",
        timestamp: new Date(baseTime).toISOString(),
      });
      eventLog.record({
        type: "task_completed",
        task_id: "fast-task",
        session_id: "w1",
        timestamp: new Date(baseTime + 1000).toISOString(),
      });

      eventLog.record({
        type: "task_claimed",
        task_id: "slow-task",
        session_id: "w1",
        timestamp: new Date(baseTime).toISOString(),
      });
      eventLog.record({
        type: "task_completed",
        task_id: "slow-task",
        session_id: "w1",
        timestamp: new Date(baseTime + 10000).toISOString(),
      });

      eventLog.record({
        type: "task_claimed",
        task_id: "medium-task",
        session_id: "w1",
        timestamp: new Date(baseTime).toISOString(),
      });
      eventLog.record({
        type: "task_completed",
        task_id: "medium-task",
        session_id: "w1",
        timestamp: new Date(baseTime + 5000).toISOString(),
      });

      await eventLog.flush();

      const analytics = await eventLog.getAnalytics();

      expect(analytics.top_bottleneck_tasks.length).toBe(3);
      // Should be sorted by duration descending
      expect(analytics.top_bottleneck_tasks[0].task_id).toBe("slow-task");
      expect(analytics.top_bottleneck_tasks[0].duration_ms).toBe(10000);
      expect(analytics.top_bottleneck_tasks[1].task_id).toBe("medium-task");
      expect(analytics.top_bottleneck_tasks[2].task_id).toBe("fast-task");
    });

    it("returns empty analytics for no events", async () => {
      const analytics = await eventLog.getAnalytics();

      expect(analytics.total_events).toBe(0);
      expect(analytics.total_workers).toBe(0);
      expect(analytics.total_tasks_completed).toBe(0);
      expect(analytics.worker_success_rate).toBe(0);
      expect(analytics.task_retry_rate).toBe(0);
      expect(analytics.top_bottleneck_tasks).toEqual([]);
      expect(analytics.phase_durations).toEqual({});
    });
  });

  describe("start/stop lifecycle", () => {
    it("isRunning reflects start/stop state", async () => {
      expect(eventLog.isRunning()).toBe(false);

      eventLog.start();
      expect(eventLog.isRunning()).toBe(true);

      await eventLog.stop();
      expect(eventLog.isRunning()).toBe(false);
    });

    it("start is idempotent", () => {
      eventLog.start();
      eventLog.start();
      eventLog.start();

      expect(eventLog.isRunning()).toBe(true);
    });

    it("stop is idempotent", async () => {
      eventLog.start();
      await eventLog.stop();
      await eventLog.stop();
      await eventLog.stop();

      expect(eventLog.isRunning()).toBe(false);
    });

    it("stop flushes remaining buffer", async () => {
      eventLog.start();

      eventLog.record({ type: "phase_start", phase: "final-flush-test" });
      expect(eventLog.getBufferSize()).toBe(1);

      await eventLog.stop();

      // Buffer should be flushed
      expect(eventLog.getBufferSize()).toBe(0);

      // Events should be persisted
      const events = await eventLog.readAll();
      expect(events.length).toBe(1);
    });

    it("can record events without starting (for manual flush use case)", async () => {
      // Record without start
      eventLog.record({ type: "phase_start", phase: "no-start" });
      expect(eventLog.getBufferSize()).toBe(1);

      // Manual flush works
      await eventLog.flush();

      const events = await eventLog.readAll();
      expect(events.length).toBe(1);
    });
  });

  describe("all event types roundtrip", () => {
    it("handles phase_start event", async () => {
      eventLog.start();
      eventLog.record({ type: "phase_start", phase: "planning" });
      await eventLog.flush();

      const events = await eventLog.readAll();
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("phase_start");
    });

    it("handles phase_end event", async () => {
      eventLog.start();
      eventLog.record({
        type: "phase_end",
        phase: "execution",
        duration_ms: 12345,
      });
      await eventLog.flush();

      const events = await eventLog.readAll();
      expect(events.length).toBe(1);
      const event = events[0] as Extract<
        StructuredEvent,
        { type: "phase_end" }
      >;
      expect(event.duration_ms).toBe(12345);
    });

    it("handles worker_spawn event", async () => {
      eventLog.start();
      eventLog.record({ type: "worker_spawn", session_id: "worker-abc" });
      await eventLog.flush();

      const events = await eventLog.readAll();
      expect(events.length).toBe(1);
      const event = events[0] as Extract<
        StructuredEvent,
        { type: "worker_spawn" }
      >;
      expect(event.session_id).toBe("worker-abc");
    });

    it("handles worker_complete event", async () => {
      eventLog.start();
      eventLog.record({
        type: "worker_complete",
        session_id: "worker-xyz",
        tasks_completed: 5,
      });
      await eventLog.flush();

      const events = await eventLog.readAll();
      expect(events.length).toBe(1);
      const event = events[0] as Extract<
        StructuredEvent,
        { type: "worker_complete" }
      >;
      expect(event.tasks_completed).toBe(5);
    });

    it("handles worker_fail event", async () => {
      eventLog.start();
      eventLog.record({
        type: "worker_fail",
        session_id: "worker-err",
        error: "Some error",
      });
      await eventLog.flush();

      const events = await eventLog.readAll();
      expect(events.length).toBe(1);
      const event = events[0] as Extract<
        StructuredEvent,
        { type: "worker_fail" }
      >;
      expect(event.error).toBe("Some error");
    });

    it("handles worker_timeout event", async () => {
      eventLog.start();
      eventLog.record({
        type: "worker_timeout",
        session_id: "worker-timeout",
        duration_ms: 2700000,
      });
      await eventLog.flush();

      const events = await eventLog.readAll();
      expect(events.length).toBe(1);
      const event = events[0] as Extract<
        StructuredEvent,
        { type: "worker_timeout" }
      >;
      expect(event.duration_ms).toBe(2700000);
    });

    it("handles task_claimed event", async () => {
      eventLog.start();
      eventLog.record({
        type: "task_claimed",
        task_id: "task-001",
        session_id: "worker-1",
      });
      await eventLog.flush();

      const events = await eventLog.readAll();
      expect(events.length).toBe(1);
      const event = events[0] as Extract<
        StructuredEvent,
        { type: "task_claimed" }
      >;
      expect(event.task_id).toBe("task-001");
      expect(event.session_id).toBe("worker-1");
    });

    it("handles task_completed event", async () => {
      eventLog.start();
      eventLog.record({
        type: "task_completed",
        task_id: "task-002",
        session_id: "worker-2",
      });
      await eventLog.flush();

      const events = await eventLog.readAll();
      expect(events.length).toBe(1);
    });

    it("handles task_failed event", async () => {
      eventLog.start();
      eventLog.record({
        type: "task_failed",
        task_id: "task-003",
        session_id: "worker-3",
        error: "Compilation error",
      });
      await eventLog.flush();

      const events = await eventLog.readAll();
      expect(events.length).toBe(1);
      const event = events[0] as Extract<
        StructuredEvent,
        { type: "task_failed" }
      >;
      expect(event.error).toBe("Compilation error");
    });

    it("handles task_retried event", async () => {
      eventLog.start();
      eventLog.record({
        type: "task_retried",
        task_id: "task-004",
        retry_count: 2,
      });
      await eventLog.flush();

      const events = await eventLog.readAll();
      expect(events.length).toBe(1);
      const event = events[0] as Extract<
        StructuredEvent,
        { type: "task_retried" }
      >;
      expect(event.retry_count).toBe(2);
    });

    it("handles review_verdict event", async () => {
      eventLog.start();
      eventLog.record({ type: "review_verdict", verdict: "approved" });
      await eventLog.flush();

      const events = await eventLog.readAll();
      expect(events.length).toBe(1);
      const event = events[0] as Extract<
        StructuredEvent,
        { type: "review_verdict" }
      >;
      expect(event.verdict).toBe("approved");
    });

    it("handles usage_warning event", async () => {
      eventLog.start();
      eventLog.record({ type: "usage_warning", utilization: 0.85 });
      await eventLog.flush();

      const events = await eventLog.readAll();
      expect(events.length).toBe(1);
      const event = events[0] as Extract<
        StructuredEvent,
        { type: "usage_warning" }
      >;
      expect(event.utilization).toBe(0.85);
    });

    it("handles scheduling_decision event", async () => {
      eventLog.start();
      eventLog.record({
        type: "scheduling_decision",
        task_id: "task-005",
        score: 120,
      });
      await eventLog.flush();

      const events = await eventLog.readAll();
      expect(events.length).toBe(1);
      const event = events[0] as Extract<
        StructuredEvent,
        { type: "scheduling_decision" }
      >;
      expect(event.score).toBe(120);
    });

    it("handles project_detection event", async () => {
      eventLog.start();
      eventLog.record({
        type: "project_detection",
        profile: {
          detected_at: "2024-01-01T00:00:00.000Z",
          languages: ["typescript"],
          frameworks: ["nextjs", "express"],
          test_runners: ["vitest"],
          linters: ["eslint", "prettier"],
          ci_systems: ["github-actions"],
          package_managers: ["npm"],
        },
      });
      await eventLog.flush();

      const events = await eventLog.readAll();
      expect(events.length).toBe(1);
      const event = events[0] as Extract<
        StructuredEvent,
        { type: "project_detection" }
      >;
      expect(event.profile.languages).toContain("typescript");
      expect(event.profile.frameworks).toContain("nextjs");
    });
  });
});

describe("computeAnalytics", () => {
  it("handles multiple phases", () => {
    const events: StructuredEvent[] = [
      { type: "phase_end", phase: "planning", duration_ms: 1000, timestamp: "" },
      { type: "phase_end", phase: "planning", duration_ms: 2000, timestamp: "" },
      { type: "phase_end", phase: "execution", duration_ms: 5000, timestamp: "" },
    ];

    const analytics = computeAnalytics(events);

    expect(analytics.phase_durations["planning"].avg_ms).toBe(1500);
    expect(analytics.phase_durations["planning"].count).toBe(2);
    expect(analytics.phase_durations["execution"].avg_ms).toBe(5000);
    expect(analytics.phase_durations["execution"].count).toBe(1);
  });

  it("handles zero workers", () => {
    const events: StructuredEvent[] = [
      { type: "phase_start", phase: "test", timestamp: "" },
    ];

    const analytics = computeAnalytics(events);

    expect(analytics.worker_success_rate).toBe(0);
    expect(analytics.total_workers).toBe(0);
  });

  it("caps bottleneck tasks at 5", () => {
    const events: StructuredEvent[] = [];
    const baseTime = Date.now();

    // Create 10 tasks
    for (let i = 0; i < 10; i++) {
      events.push({
        type: "task_claimed",
        task_id: `task-${i}`,
        session_id: "w1",
        timestamp: new Date(baseTime).toISOString(),
      });
      events.push({
        type: "task_completed",
        task_id: `task-${i}`,
        session_id: "w1",
        timestamp: new Date(baseTime + (i + 1) * 1000).toISOString(),
      });
    }

    const analytics = computeAnalytics(events);

    // Should only have top 5
    expect(analytics.top_bottleneck_tasks.length).toBe(5);
    // Should be sorted by duration (task-9 is longest at 10000ms)
    expect(analytics.top_bottleneck_tasks[0].task_id).toBe("task-9");
  });
});

describe("formatAnalyticsForDisplay", () => {
  it("produces valid markdown", () => {
    const analytics = {
      phase_durations: { planning: { avg_ms: 5000, count: 2 } },
      worker_success_rate: 75,
      task_retry_rate: 10,
      top_bottleneck_tasks: [{ task_id: "task-001", duration_ms: 30000 }],
      total_events: 100,
      total_workers: 4,
      total_tasks_completed: 20,
    };

    const output = formatAnalyticsForDisplay(analytics);

    expect(output).toContain("## Event Log Analytics");
    expect(output).toContain("**Total Events:** 100");
    expect(output).toContain("**Total Workers:** 4");
    expect(output).toContain("**Tasks Completed:** 20");
    expect(output).toContain("**Worker Success Rate:** 75%");
    expect(output).toContain("**Task Retry Rate:** 10%");
    expect(output).toContain("### Phase Durations");
    expect(output).toContain("**planning:** 5.0s (2 runs)");
    expect(output).toContain("### Top Bottleneck Tasks");
    expect(output).toContain("**task-001:** 30.0s");
  });

  it("handles empty analytics", () => {
    const analytics = {
      phase_durations: {},
      worker_success_rate: 0,
      task_retry_rate: 0,
      top_bottleneck_tasks: [],
      total_events: 0,
      total_workers: 0,
      total_tasks_completed: 0,
    };

    const output = formatAnalyticsForDisplay(analytics);

    expect(output).toContain("## Event Log Analytics");
    expect(output).toContain("**Total Events:** 0");
    // Should not have phase durations section
    expect(output).not.toContain("### Phase Durations");
    // Should not have bottleneck section (or empty one)
  });
});
