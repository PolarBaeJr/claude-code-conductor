# Adversarial Code Review: v0.4.3 / v0.4.4 / v0.4.5

**Reviewer:** Claude Opus 4.6 (1M context)
**Date:** 2026-03-16
**Commits reviewed:** 4d486b9 (v0.4.3), 5e878c9 (v0.4.4), 1143071 (v0.4.5)

## Summary

**Issues Found:** 0 breaking issues
**Build:** Clean (tsc compiles with no errors)
**Tests:** 826/826 passing

---

## Change 1: permissionMode fix (v0.4.3)

### Investigation

**All SDK `query()` call sites accounted for:**
1. `sdk-timeout.ts:55` -- `queryWithTimeout()` wrapper. Now sets `permissionMode: "bypassPermissions"` with conditional `allowDangerouslySkipPermissions: true`. This is the centralized wrapper used by planner, flow-tracer, orchestrator, prompt-compactor, and conventions-extractor.
2. `worker-manager.ts:468` -- `runWorker()` direct call. Now has `permissionMode: "bypassPermissions"` and `allowDangerouslySkipPermissions: true`.
3. `worker-manager.ts:571` -- `runSentinelWorker()` direct call. Same fix applied.

**No unpatched call sites.** The only other SDK import is `createSdkMcpServer` in `planner.ts`, which is for MCP servers, not `query()`.

**Type imports verified:** `PermissionMode` is correctly imported as a type from `@anthropic-ai/claude-agent-sdk` in `sdk-timeout.ts`.

**Test compatibility verified:** No test asserts on the specific options passed to `query()`. The mock in `orchestrator-integration.test.ts` returns an async iterable and does not inspect options.

**Verdict:** VALID change, no issues found.

---

## Change 2: Worker prompt execution discipline (v0.4.4)

### Investigation

**New sections added:**
1. "Use agent teams for complex tasks" + "Write before you spawn" -- only included when `runtime === "claude"`, correctly excluded for codex runtime.
2. "Execution Discipline" section (computation directive + scope guidance) -- always included, no conditions.

**Duplication check:**
- "Stay in your lane" has minor thematic overlap with persona anti-patterns ("no scope creep" in testing persona), but they are in different sections (general rules vs task-specific persona) and complementary, not contradictory.
- "Use code for computation" is unique -- no similar directive elsewhere.
- "Write before you spawn" is unique guidance about subagent context handoff.

**Test compatibility:** `worker-prompt.test.ts` tests pass. The tests check for section headers (`## Orchestration Protocol`, `## Security Requirements`) and sanitization behavior -- no assertions broken by the new sections.

**Formatting note:** When `runtime === "codex"`, `internalTeamGuidance` is empty and `.join("\n")` produces `""`, leaving a blank line in the bullet list. This is cosmetic and pre-existing (same pattern as `windDownExtraSteps`). Not a regression.

**Verdict:** VALID change, no issues found.

---

## Change 3: Codex model auto-detection (v0.4.5)

### Investigation

**`_codexAccountType` module-level cache:**
- Cache is set on first call to `detectCodexAccountType()` and never cleared.
- This is correct for production: account type cannot change during a single conductor process run.
- No test currently needs to test both "api" and "chatgpt" code paths, so the cache does not cause test failures.
- If future tests need to exercise both paths, they would need to either use `vi.resetModules()` or add a `resetCodexAccountTypeCache()` export. This is a latent testability concern, not a current bug.

**`CODEX_MODEL_MAP` deprecated export:**
- Still exported with `@deprecated` JSDoc tag, pointing to `CODEX_MODEL_MAP_API`.
- No file in the codebase imports `CODEX_MODEL_MAP`. The deprecated export is dead code kept "for test compatibility" but no test uses it.
- Not harmful, just unnecessary.

**`fs.readFileSync` in `detectCodexAccountType()`:**
- Called inside a function (not at module import time), so it does not block module loading.
- Wrapped in try/catch, so missing `~/.codex/auth.json` is handled gracefully (defaults to "chatgpt").
- Invalid JSON in auth.json is caught and defaults to "chatgpt".

**`os` and `fs` imports in constants.ts:**
- Both are Node.js builtins. No compatibility issues with vitest test environment.

**CLI/orchestrator display:**
- Neither `orchestrator.ts` nor `cli.ts` references `CODEX_MODEL_MAP` for display.
- `codex-worker-manager.ts` correctly uses `getCodexModel()` in both `buildCodexExecArgs()` and `buildResumeArgs()`.

**Test verification:**
- `codex-worker-manager.test.ts` imports `getCodexModel` and verifies it returns non-empty strings for all tiers.
- Tests use `await import()` which correctly resolves the function from the compiled module.

**Verdict:** VALID change, no issues found.

---

## Verification

```
npm run build: PASS (clean compilation)
npm test: 826/826 tests passing
```

## Conclusion

All three changes are correctly implemented. No bugs, edge case failures, broken tests, or compatibility issues were found after exhaustive review of:
- All 3 SDK `query()` call sites for permissionMode coverage
- All callers of `queryWithTimeout()` (9 files)
- All references to `CODEX_MODEL_MAP` (only in constants.ts itself)
- All test files that reference changed code
- Worker prompt section ordering and duplication
- Module-level cache behavior in constants.ts
- Build and full test suite execution
