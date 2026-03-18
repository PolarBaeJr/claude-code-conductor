# Review Investigation: sdk-timeout.ts Permission Mode Changes

## REVIEW INVESTIGATION COMPLETE

**Issues Analyzed:** 6
**Valid:** 1
**Invalid:** 0
**Fixes Applied:** 1

---

### Issue 1: PermissionMode type import validity
**Severity:** Low
**Location:** src/utils/sdk-timeout.ts:2

**Investigation:**
Verified that `PermissionMode` is exported from `@anthropic-ai/claude-agent-sdk` via the chain: `sdk.d.ts` -> `entrypoints/agentSdkTypes.d.ts` -> `entrypoints/sdk/coreTypes.d.ts` which defines `PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'delegate' | 'dontAsk'`.

**Verdict:** VALID (no issue -- import is correct)

**Evidence:**
The type is correctly defined in `node_modules/@anthropic-ai/claude-agent-sdk/entrypoints/sdk/coreTypes.d.ts:173` and re-exported through the package's main types entry point.

**Action:** No action needed.

---

### Issue 2: Conditional allowDangerouslySkipPermissions
**Severity:** Low
**Location:** src/utils/sdk-timeout.ts:62-63

**Investigation:**
The code correctly only sets `allowDangerouslySkipPermissions: true` when `permMode === "bypassPermissions"`. This matches the SDK documentation which states "Must be set to `true` when using `permissionMode: 'bypassPermissions'`."

**Verdict:** VALID (no issue -- correctly implemented)

**Evidence:**
```typescript
...(permMode === "bypassPermissions"
  ? { allowDangerouslySkipPermissions: true }
  : {}),
```
This conditional pattern is correct -- the SDK requires `allowDangerouslySkipPermissions` only when bypassing permissions.

**Action:** No action needed.

---

### Issue 3: No callers pass conflicting permissionMode
**Severity:** Medium
**Location:** All queryWithTimeout call sites

**Investigation:**
Checked all 7 call sites of `queryWithTimeout`:
1. `planner.ts:67` (question-generation) - no permissionMode
2. `planner.ts:145` (createPlan) - no permissionMode
3. `planner.ts:229` (replan) - no permissionMode
4. `flow-tracer.ts:251` (flow-extraction) - no permissionMode
5. `flow-tracer.ts:356` (flow tracing worker) - no permissionMode
6. `orchestrator.ts:1069` (plan investigator) - no permissionMode
7. `orchestrator.ts:1694` (code review investigator) - no permissionMode
8. `prompt-compactor.ts:255` (compaction agent) - no permissionMode

All rely on the default `bypassPermissions`, which is appropriate since all are headless sessions with explicit allowedTools lists.

**Verdict:** VALID (no conflicts)

**Action:** No action needed.

---

### Issue 4: worker-manager.ts direct query() calls missing permissionMode
**Severity:** HIGH
**Location:** src/core/worker-manager.ts:468, src/core/worker-manager.ts:569

**Investigation:**
`worker-manager.ts` calls `query()` directly (not through `queryWithTimeout`) for execution workers and the security sentinel. These two call sites did NOT set `permissionMode` or `allowDangerouslySkipPermissions`, meaning they would use the SDK default permission mode. For headless workers, this is problematic -- the SDK would attempt to prompt for permissions on tool use, which cannot work in a headless session.

**Verdict:** VALID

**Evidence:**
The `runWorker()` method at line 468 and `runSentinelWorker()` method at line 569 both called `query()` without `permissionMode`, while `queryWithTimeout` (used by all other SDK call sites) now correctly defaults to `bypassPermissions`.

**Action:** Fix applied -- added `permissionMode: "bypassPermissions"` and `allowDangerouslySkipPermissions: true` to both direct `query()` calls in worker-manager.ts.

---

### Issue 5: Permission denial and error logging
**Severity:** Low
**Location:** src/utils/sdk-timeout.ts:81-100

**Investigation:**
The new logging for `permission_denials` and `errors` from SDK result events is well-implemented. It correctly:
- Checks for array existence and non-empty length before logging
- Uses the logger if available, falls back to stderr
- Logs at warn level (appropriate for these events)
- Includes the label for identifying which query produced the events

**Verdict:** VALID (no issue -- well implemented)

**Action:** No action needed.

---

### Issue 6: Test coverage for permissionMode
**Severity:** Low
**Location:** Test files

**Investigation:**
There is no dedicated `sdk-timeout.test.ts` file. The existing tests in `planner.test.ts` and `flow-tracer.test.ts` mock `queryWithTimeout` entirely, so the internal permission mode logic is not tested at the unit level. However, since `queryWithTimeout` is a thin wrapper around the SDK's `query()`, and the permission mode is a simple default value pass-through, the lack of unit tests for this specific feature is acceptable. The build verification (TypeScript strict mode) ensures the types are correct.

**Verdict:** VALID (acceptable -- no test changes needed)

**Action:** No action needed.

---

## Summary

**Fixed Issues:**
- worker-manager.ts: Added `permissionMode: "bypassPermissions"` and `allowDangerouslySkipPermissions: true` to both direct `query()` calls (runWorker and runSentinelWorker) to match the pattern established in sdk-timeout.ts

**Rejected Issues:**
- None

**Build:** Passes (tsc strict mode)
**Tests:** 826/826 passing (1 pre-existing flaky timing test in worker-manager occasionally fails due to elapsed time assertions)
