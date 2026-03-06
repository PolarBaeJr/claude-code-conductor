/**
 * Worker Resilience Module (V2)
 *
 * Provides three classes for worker lifecycle management:
 * - TaskRetryTracker: Tracks task failures and retry context
 * - WorkerTimeoutTracker: Detects workers exceeding wall-clock timeout
 * - HeartbeatTracker: Detects stalled workers with no recent activity
 */

import {
  DEFAULT_WORKER_TIMEOUT_MS,
  MAX_TASK_RETRIES,
  HEARTBEAT_STALE_THRESHOLD_MS,
} from "../utils/constants.js";

// ============================================================
// Error Sanitization
// ============================================================

/**
 * Sanitizes error messages before injecting into worker prompts.
 * Security requirements:
 * - Truncate to 500 characters to prevent DoS
 * - Remove file paths that might leak system info
 * - Escape markdown special characters
 * - Remove potential prompt injection patterns
 */
export function sanitizeErrorForPrompt(error: string): string {
  if (!error) return "";

  let sanitized = error;

  // Remove file paths (Unix and Windows)
  // Matches patterns like /home/user/... or C:\Users\...
  sanitized = sanitized.replace(
    /(?:\/[\w.-]+)+(?:\/[\w.-]+)*|(?:[A-Za-z]:\\[\w.-]+)+(?:\\[\w.-]+)*/g,
    "[path]"
  );

  // Remove potential prompt injection patterns
  // These could be attempts to escape the error context
  const injectionPatterns = [
    /```[\s\S]*?```/g, // Code blocks
    /<[^>]+>/g, // HTML-like tags
    /\[INST\].*?\[\/INST\]/gi, // Instruction markers
    /<<SYS>>.*?<\/SYS>>/gi, // System markers
    /Human:|Assistant:|User:|System:/gi, // Role markers
  ];

  for (const pattern of injectionPatterns) {
    sanitized = sanitized.replace(pattern, "[removed]");
  }

  // Escape markdown special characters that could affect formatting
  sanitized = sanitized
    .replace(/\\/g, "\\\\")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/`/g, "\\`")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");

  // Truncate to 500 characters
  if (sanitized.length > 500) {
    sanitized = sanitized.slice(0, 497) + "...";
  }

  return sanitized;
}

// ============================================================
// TaskRetryTracker
// ============================================================

interface RetryState {
  count: number;
  lastError: string | null;
  exhausted: boolean;
}

/**
 * Tracks task failures and manages retry logic.
 *
 * Features:
 * - Records failures with sanitized error messages
 * - Determines whether a task should be retried
 * - Generates retry context for worker prompt injection
 * - Handles retry exhaustion
 */
export class TaskRetryTracker {
  private retryState: Map<string, RetryState> = new Map();
  private maxRetries: number;

  constructor(maxRetries: number = MAX_TASK_RETRIES) {
    this.maxRetries = maxRetries;
  }

  /**
   * Records a task failure with sanitized error message.
   * Increments the retry count for the task.
   */
  recordFailure(taskId: string, error: string): void {
    const sanitizedError = sanitizeErrorForPrompt(error);
    const existing = this.retryState.get(taskId);

    if (existing) {
      existing.count++;
      existing.lastError = sanitizedError;
      // Check if now exhausted
      if (existing.count >= this.maxRetries) {
        existing.exhausted = true;
      }
    } else {
      this.retryState.set(taskId, {
        count: 1,
        lastError: sanitizedError,
        exhausted: 1 >= this.maxRetries,
      });
    }
  }

  /**
   * Returns true if the task can be retried (hasn't exhausted retries).
   */
  shouldRetry(taskId: string): boolean {
    const state = this.retryState.get(taskId);
    if (!state) return true; // Never failed, can try

    return !state.exhausted && state.count < this.maxRetries;
  }

  /**
   * Returns formatted error context for worker prompt injection.
   * Returns null if no failure has been recorded.
   */
  getRetryContext(taskId: string): string | null {
    const state = this.retryState.get(taskId);
    if (!state || !state.lastError) return null;

    return (
      `**Retry Context:** Previous attempt failed: ${state.lastError}\n` +
      `This is retry ${state.count} of ${this.maxRetries}.`
    );
  }

  /**
   * Marks a task as no longer retryable (exhausted).
   */
  markExhausted(taskId: string): void {
    const state = this.retryState.get(taskId);
    if (state) {
      state.exhausted = true;
    } else {
      this.retryState.set(taskId, {
        count: this.maxRetries,
        lastError: null,
        exhausted: true,
      });
    }
  }

  /**
   * Returns the current retry count for a task.
   * Returns 0 if the task has never failed.
   */
  getRetryCount(taskId: string): number {
    return this.retryState.get(taskId)?.count ?? 0;
  }

  /**
   * Returns the last error message for a task.
   * Returns null if no error has been recorded.
   */
  getLastError(taskId: string): string | null {
    return this.retryState.get(taskId)?.lastError ?? null;
  }

  /**
   * Clears retry state for a task (e.g., when it completes successfully).
   */
  clear(taskId: string): void {
    this.retryState.delete(taskId);
  }
}

// ============================================================
// WorkerTimeoutTracker
// ============================================================

/**
 * Tracks worker start times and detects wall-clock timeouts.
 *
 * Features:
 * - Records when workers start
 * - Detects workers that exceed the configured timeout
 * - Provides list of all timed-out workers
 * - Cleanup to prevent memory leaks
 */
export class WorkerTimeoutTracker {
  private startTimes: Map<string, number> = new Map();
  private timeoutMs: number;

  constructor(timeoutMs: number = DEFAULT_WORKER_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Starts tracking a worker's lifetime.
   */
  startTracking(sessionId: string): void {
    this.startTimes.set(sessionId, Date.now());
  }

  /**
   * Returns true if the worker has exceeded the timeout.
   * Returns false if the worker is not being tracked.
   */
  isTimedOut(sessionId: string): boolean {
    const startTime = this.startTimes.get(sessionId);
    if (startTime === undefined) return false;

    return Date.now() - startTime > this.timeoutMs;
  }

  /**
   * Returns all session IDs that have timed out.
   */
  getTimedOutWorkers(): string[] {
    const now = Date.now();
    const timedOut: string[] = [];

    for (const [sessionId, startTime] of this.startTimes) {
      if (now - startTime > this.timeoutMs) {
        timedOut.push(sessionId);
      }
    }

    return timedOut;
  }

  /**
   * Returns the elapsed time in milliseconds for a worker.
   * Returns 0 if the worker is not being tracked.
   */
  getElapsedMs(sessionId: string): number {
    const startTime = this.startTimes.get(sessionId);
    if (startTime === undefined) return 0;

    return Date.now() - startTime;
  }

  /**
   * Stops tracking a worker (removes from tracking).
   */
  stopTracking(sessionId: string): void {
    this.startTimes.delete(sessionId);
  }

  /**
   * Returns the start time for a worker.
   * Returns null if the worker is not being tracked.
   */
  getStartTime(sessionId: string): number | null {
    return this.startTimes.get(sessionId) ?? null;
  }
}

// ============================================================
// HeartbeatTracker
// ============================================================

/**
 * Tracks worker activity via heartbeats.
 * Workers are expected to send heartbeats (e.g., on tool_use events).
 * If no heartbeat is received within the threshold, the worker is stale.
 *
 * Features:
 * - Records heartbeat timestamps
 * - Detects stale workers (no recent activity)
 * - Cleanup to prevent memory leaks from dead workers
 */
export class HeartbeatTracker {
  private lastHeartbeat: Map<string, number> = new Map();
  private staleThresholdMs: number;

  constructor(staleThresholdMs: number = HEARTBEAT_STALE_THRESHOLD_MS) {
    this.staleThresholdMs = staleThresholdMs;
  }

  /**
   * Records a heartbeat for a worker.
   */
  recordHeartbeat(sessionId: string): void {
    this.lastHeartbeat.set(sessionId, Date.now());
  }

  /**
   * Returns true if the worker is stale (no heartbeat within threshold).
   * Returns false if the worker has never been tracked (new worker).
   */
  isStale(sessionId: string): boolean {
    const lastBeat = this.lastHeartbeat.get(sessionId);
    if (lastBeat === undefined) return false; // Never tracked, not stale

    return Date.now() - lastBeat > this.staleThresholdMs;
  }

  /**
   * Returns all session IDs that are stale.
   */
  getStaleWorkers(): string[] {
    const now = Date.now();
    const stale: string[] = [];

    for (const [sessionId, lastBeat] of this.lastHeartbeat) {
      if (now - lastBeat > this.staleThresholdMs) {
        stale.push(sessionId);
      }
    }

    return stale;
  }

  /**
   * Returns the last heartbeat timestamp in milliseconds.
   * Returns null if the worker has never sent a heartbeat.
   */
  getLastHeartbeatMs(sessionId: string): number | null {
    return this.lastHeartbeat.get(sessionId) ?? null;
  }

  /**
   * Returns the time since last heartbeat in milliseconds.
   * Returns null if the worker has never sent a heartbeat.
   */
  getTimeSinceLastHeartbeatMs(sessionId: string): number | null {
    const lastBeat = this.lastHeartbeat.get(sessionId);
    if (lastBeat === undefined) return null;

    return Date.now() - lastBeat;
  }

  /**
   * Removes a worker from tracking to prevent memory leaks.
   * Should be called when a worker exits.
   */
  cleanup(sessionId: string): void {
    this.lastHeartbeat.delete(sessionId);
  }
}
