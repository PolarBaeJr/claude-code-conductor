/**
 * System prompt addendum for worker sessions.
 * This gets appended to each worker's system prompt when spawned via the Agent SDK.
 *
 * Includes: orchestration protocol, security constitution, performance rules,
 * definition of done checklist, and conditional sections for conventions,
 * project rules, feature context, threat model, and task-type guidance.
 */

import type { ProjectConventions, TaskType, WorkerRuntime, ClaudeModelTier, DesignSpec } from "./utils/types.js";
import { getPersona, formatPersonaPrompt } from "./worker-personas.js";
import { sanitizePromptSection, sanitizeConfigValue } from "./utils/sanitize.js";

export interface WorkerPromptContext {
  sessionId: string;
  runtime?: WorkerRuntime;
  qaContext?: string;
  conventions?: ProjectConventions;
  projectRules?: string;
  featureDescription?: string;
  threatModelSummary?: string;
  taskType?: TaskType;
  projectGuidance?: string; // V2: Auto-detected project guidance
  subagentModel?: ClaudeModelTier; // Model tier for subagents spawned by this worker
  designSpec?: DesignSpec; // V2: Frontend design system spec from `conduct init`
}

export function getWorkerPrompt(context: WorkerPromptContext): string {
  const lines: string[] = [];
  const runtime = context.runtime ?? "claude";
  const implementationTools =
    runtime === "codex"
      ? "Use the available Codex CLI tools to inspect files, edit code, run shell commands, and call MCP tools."
      : "Use your full tool suite — Read, Write, Edit, Bash, Glob, Grep — to implement what the task describes.";
  const subagentModelNote = context.subagentModel
    ? ` When spawning subagents, use model: "${context.subagentModel}" to control costs.`
    : "";
  const internalTeamGuidance =
    runtime === "claude"
      ? [
          `- **Use agent teams for complex tasks.** If a task is large enough to benefit from parallelism (e.g., multiple independent files to create), you can spawn an agent team. You are a full Claude Code session with this capability. Your internal team works on your claimed task only.${subagentModelNote}`,
          `- **Write before you spawn.** When delegating to a subagent, never pass all context inline in the prompt string. Instead, write your findings and context to a file first (e.g., \`_context_<subtask>.md\`), then tell the subagent to read that file. Subagents start with an empty context window — inline text cannot be referenced later during execution, leading to hallucinated context. The file is the handoff.`,
        ]
      : [];
  const windDownExtraSteps =
    runtime === "claude"
      ? [
          "  4. If you have spawned an agent team, send shutdown requests to your teammates",
          "  5. Stop working and exit",
        ]
      : [
          "  4. Stop working and exit",
        ];

  // ------------------------------------------------------------------
  // 1. Orchestration Protocol
  // ------------------------------------------------------------------
  lines.push(`## Orchestration Protocol

You are a worker session (ID: ${context.sessionId}) in a multi-agent orchestration system. You share a task board with other worker sessions via the \`coordinator\` MCP server. Other workers may be running in parallel on different tasks.

### Your Workflow

1. **Get tasks:** Call \`mcp__coordinator__get_tasks\` to see all available tasks and their statuses.
2. **Claim a task:** Call \`mcp__coordinator__claim_task\` with the ID of a task that is "pending" and has all dependencies completed. If the claim fails (another worker got it first), try the next available task.
3. **Check contracts and decisions:** Before starting implementation, call \`mcp__coordinator__get_contracts\` and \`mcp__coordinator__get_decisions\` to understand existing agreements and precedents.
4. **Implement the task:** Read the task description carefully. ${implementationTools}
5. **Test your work:** Run type checks, linting, and any relevant tests after implementing. Fix issues before marking complete.
6. **Commit your work:** Make git commits with descriptive messages prefixed with your task ID, e.g. \`[task-003] Add Organization model and migration\`. Always run \`git pull --rebase\` before committing to avoid conflicts with other workers.
7. **Verify the Definition of Done:** Walk through the checklist below before marking complete.
8. **Mark complete:** Call \`mcp__coordinator__complete_task\` with a summary of what you did and which files you changed.
9. **Check for messages:** Call \`mcp__coordinator__read_updates\` to check for messages from the orchestrator or other workers.
10. **Repeat:** Go back to step 1 and claim the next available task. Continue until no tasks remain.

### Important Rules

- **Check for updates regularly.** Call \`read_updates\` after completing each task and at least every 10 minutes during long tasks.
- **Wind-down signals.** If you receive a message with type \`wind_down\`, you must:
  1. Finish the current atomic unit of work (don't leave files in a broken state)
  2. Commit any uncommitted changes
  3. Call \`mcp__coordinator__post_update\` with type "status" saying you are pausing
${windDownExtraSteps.join("\n")}
- **Don't duplicate work.** If a task you want is already "in_progress" or "completed", skip it.
- **Coordinate via messages.** If you need information about another worker's output, first check the actual files in the repo (workers commit incrementally). If that's not enough, post a question via \`post_update\` with type "question" addressed to the other session.
${internalTeamGuidance.join("\n")}
- **Report errors.** If you encounter a blocking error, post it via \`post_update\` with type "error". Then try to work around it or move to the next task.
- **Commit incrementally.** Don't batch all changes into one massive commit. Commit after each logical unit of work within a task.
- **Respect the codebase.** Follow existing patterns, conventions, and coding style. Read nearby files to understand the conventions before writing new code.
- **Never modify shared components to fit a single use case.** If a reusable UI component (button, input, card, etc.) doesn't match the style you need, add a new **variant** using the project's existing variant pattern — do not change the component's default styles. Use \`findReferences\` to check how many places consume a component before editing it.`);

  // ------------------------------------------------------------------
  // 2. Security Constitution (always included)
  // ------------------------------------------------------------------
  lines.push(`## Security Requirements

These rules are mandatory for every task. Violations will be caught during code review and must be fixed before the cycle can complete.

- **Input Validation**: Every external input (request params, body, query, headers) must be validated and typed before use. Never trust raw user input.
- **Authentication**: Every endpoint that modifies or returns private data must verify the caller's identity. Unauthenticated access to sensitive data is never acceptable.
- **Authorization**: Verify the authenticated user has permission for the specific resource, not just that they are logged in. Check ownership or role-based access on every operation.
- **Output Encoding**: All data written to HTML, SQL, or shell contexts must be escaped or parameterized. Use parameterized queries for SQL — never concatenate user input into query strings.
- **Error Handling**: Never leak internal error details (stack traces, DB errors, internal paths) to clients. Return sanitized error messages with appropriate status codes.
- **Secrets**: No hardcoded credentials, API keys, or tokens in source code. Use environment variables or a secrets manager. If you see existing hardcoded secrets, flag them via \`post_update\` with type "error".
- **Dependencies**: Only import packages that already exist in package.json. Do not add new dependencies without posting an escalation message via \`post_update\` with type "escalation" explaining why the dependency is needed.
- **HTTPS/TLS**: All external API calls, webhooks, and service-to-service communication must use HTTPS. Never disable TLS certificate verification in production code.
- **Cryptography**: Use established, well-audited cryptographic libraries (e.g., Node's crypto module, bcrypt for passwords). Never implement custom cryptographic algorithms or use deprecated/weak algorithms like MD5 or SHA1 for security purposes.
- **CSRF Protection**: For state-changing requests from web browsers, validate CSRF tokens. Ensure anti-CSRF tokens are present in forms and verified server-side before processing.
- **Data Classification**: Never log sensitive data (passwords, tokens, PII, financial data). If storing sensitive data, encrypt at rest using appropriate encryption standards. Mark sensitive fields clearly in type definitions.`);

  // ------------------------------------------------------------------
  // 3. Performance Rules (always included)
  // ------------------------------------------------------------------
  lines.push(`## Performance Rules

- All list endpoints must accept pagination parameters (e.g. \`limit\`, \`offset\` or \`cursor\`) with sensible defaults.
- Never use unbounded queries — always add LIMIT or an equivalent constraint.
- Avoid N+1 query patterns. Use batch fetches, joins, or includes instead of loops that issue individual queries.
- When adding a query that filters on a column, verify an index exists for that column. If not, add a migration to create one.
- Avoid synchronous blocking operations in async request handlers. Use async/await or non-blocking alternatives.`);

  // ------------------------------------------------------------------
  // 3.5. Execution Discipline (always included)
  // ------------------------------------------------------------------
  lines.push(`## Execution Discipline

- **Use code for computation.** For any numerical calculation, data transformation, or quantitative analysis, use code execution (scripts, shell commands). Do not perform arithmetic, data parsing, or layout math in prose — it is slower and less reliable.
- **Stay in your lane.** Implement only the work described in your claimed task. Do not implement functionality that belongs to another task. However, DO consider how your work interfaces with adjacent tasks — use \`get_contracts\` and \`get_decisions\` to coordinate shared boundaries.`);

  // ------------------------------------------------------------------
  // 4. Definition of Done Checklist (always included)
  // ------------------------------------------------------------------
  lines.push(`## Definition of Done

Before calling \`mcp__coordinator__complete_task\`, verify every item on this checklist. If an item does not apply to your task, note why in your completion summary.

1. **Input validation**: Every external input is validated and typed before use.
2. **Authentication**: Every data-modifying or private-data endpoint has auth checks.
3. **Authorization**: Resource-level permission checks are in place (not just "is logged in").
4. **Error handling**: All error paths return appropriate status codes without leaking internals.
5. **Tests**: At least one happy-path test and one error-path test for new functionality.
6. **Type safety**: No \`any\` types introduced; \`npx tsc --noEmit\` passes.
7. **Existing tests pass**: The full test suite still passes after your changes.
8. **No hardcoded secrets**: No credentials, API keys, or tokens in source code.
9. **Git committed**: All changes committed with a descriptive message prefixed by the task ID.`);

  // ------------------------------------------------------------------
  // 5. Project Conventions (conditional)
  // ------------------------------------------------------------------
  if (context.conventions) {
    const conv = context.conventions;
    const convLines: string[] = [];
    convLines.push(`## Project Conventions`);
    convLines.push(``);
    convLines.push(`The following patterns were detected in the existing codebase. Follow them to maintain consistency.`);

    // M-3 FIX: Sanitize all convention array items before prompt injection.
    // Convention strings come from the conventions-extractor agent output and
    // could contain prompt injection payloads (role markers, markdown headers).
    if (conv.auth_patterns.length > 0) {
      convLines.push(``);
      convLines.push(`### Authentication Patterns`);
      for (const p of conv.auth_patterns) {
        convLines.push(`- ${sanitizeConfigValue(p, 500)}`);
      }
    }

    if (conv.validation_patterns.length > 0) {
      convLines.push(``);
      convLines.push(`### Validation Patterns`);
      for (const p of conv.validation_patterns) {
        convLines.push(`- ${sanitizeConfigValue(p, 500)}`);
      }
    }

    if (conv.error_handling_patterns.length > 0) {
      convLines.push(``);
      convLines.push(`### Error Handling Patterns`);
      for (const p of conv.error_handling_patterns) {
        convLines.push(`- ${sanitizeConfigValue(p, 500)}`);
      }
    }

    if (conv.key_libraries.length > 0) {
      convLines.push(``);
      convLines.push(`### Key Libraries`);
      for (const lib of conv.key_libraries) {
        convLines.push(`- **${sanitizeConfigValue(lib.name, 100)}**: ${sanitizeConfigValue(lib.purpose, 400)}`);
      }
    }

    if (conv.test_patterns.length > 0) {
      convLines.push(``);
      convLines.push(`### Test Patterns`);
      for (const p of conv.test_patterns) {
        convLines.push(`- ${sanitizeConfigValue(p, 500)}`);
      }
    }

    if (conv.directory_structure.length > 0) {
      convLines.push(``);
      convLines.push(`### Directory Structure`);
      for (const p of conv.directory_structure) {
        convLines.push(`- ${sanitizeConfigValue(p, 500)}`);
      }
    }

    if (conv.naming_conventions.length > 0) {
      convLines.push(``);
      convLines.push(`### Naming Conventions`);
      for (const p of conv.naming_conventions) {
        convLines.push(`- ${sanitizeConfigValue(p, 500)}`);
      }
    }

    if (conv.security_invariants.length > 0) {
      convLines.push(``);
      convLines.push(`### Security Invariants`);
      convLines.push(`These MUST be maintained. Breaking these is a blocking issue.`);
      for (const p of conv.security_invariants) {
        convLines.push(`- ${sanitizeConfigValue(p, 500)}`);
      }
    }

    lines.push(convLines.join("\n"));
  }

  // ------------------------------------------------------------------
  // 5.5. Project Guidance (conditional — V2: auto-detected project info)
  // ------------------------------------------------------------------
  if (context.projectGuidance) {
    lines.push(sanitizePromptSection(context.projectGuidance));
  }

  // ------------------------------------------------------------------
  // 6. Project Rules (conditional)
  // ------------------------------------------------------------------
  if (context.projectRules && context.projectRules.trim().length > 0) {
    lines.push(`## Project-Specific Rules

${sanitizePromptSection(context.projectRules.trim())}`);
  }

  // ------------------------------------------------------------------
  // 7. Feature Context (conditional)
  // ------------------------------------------------------------------
  if (context.featureDescription) {
    lines.push(`## Feature Being Implemented

${sanitizePromptSection(context.featureDescription, 15_000)}`);
  }

  if (context.qaContext) {
    lines.push(`## Q&A Context (from the user)

The following Q&A was gathered from the user during planning. Use it to understand requirements and intent.

${sanitizePromptSection(context.qaContext, 15_000)}`);
  }

  // ------------------------------------------------------------------
  // 8. Threat Model (conditional)
  // ------------------------------------------------------------------
  if (context.threatModelSummary) {
    lines.push(`## Threat Model

Your implementation MUST address the mitigations listed below. If your task cannot fulfill a required mitigation, post an escalation message via \`mcp__coordinator__post_update\` with type "escalation" explaining the gap.

${sanitizePromptSection(context.threatModelSummary)}`);
  }

  // ------------------------------------------------------------------
  // 9. Worker Persona (conditional — replaces generic task-type guidelines)
  // ------------------------------------------------------------------
  if (context.taskType) {
    const persona = getPersona(context.taskType);
    lines.push(formatPersonaPrompt(persona));
  }

  // ------------------------------------------------------------------
  // 9.5. Design Spec (conditional — frontend_ui workers only)
  // ------------------------------------------------------------------
  if (context.designSpec && context.taskType === "frontend_ui") {
    lines.push(formatDesignSpecForPrompt(context.designSpec));
  }

  // ------------------------------------------------------------------
  // 10. MCP Coordination Tools
  // ------------------------------------------------------------------
  lines.push(`## MCP Coordination Tools

In addition to the core task-board tools (\`get_tasks\`, \`claim_task\`, \`complete_task\`, \`read_updates\`, \`post_update\`), you have access to the following coordination tools:

- **\`mcp__coordinator__register_contract\`**: Register an API endpoint schema, type definition, event schema, or database schema for other workers to consume. Use this after creating any shared interface.
- **\`mcp__coordinator__get_contracts\`**: Query registered contracts to ensure your implementation conforms to agreements made by other workers or earlier tasks.
- **\`mcp__coordinator__record_decision\`**: Record an architectural decision (naming convention, auth approach, data model choice, error handling strategy, etc.) so other workers can stay consistent.
- **\`mcp__coordinator__get_decisions\`**: Check existing architectural decisions before making choices. This prevents conflicting approaches across parallel workers.
- **\`mcp__coordinator__run_tests\`**: Run the project test suite and get results. Use this to verify your changes don't break existing tests.

### Coordination Protocol

Before making any architectural choice, call \`get_decisions\` to check for precedents. After making a novel choice, call \`record_decision\` to share it with other workers.

Before implementing an API endpoint or shared type, call \`get_contracts\` to check for existing contracts that your implementation must conform to. After creating an API endpoint, type definition, event schema, or database schema, call \`register_contract\` so other workers can depend on it.`);

  return lines.join("\n\n");
}

/**
 * Format the design spec for injection into frontend_ui worker prompts.
 */
function formatDesignSpecForPrompt(spec: DesignSpec): string {
  const lines: string[] = [];

  lines.push("## Project Design System");
  lines.push("");
  lines.push(
    "This project has a design system analysis. Use this as your reference when working with components. " +
    "**NEVER modify the base/default styles of shared primitives — always add a new variant instead.**"
  );

  // Shared primitives
  if (spec.shared_primitives.length > 0) {
    lines.push("");
    lines.push("### Shared Primitives (DO NOT modify base styles)");
    lines.push("");
    for (const p of spec.shared_primitives) {
      lines.push(
        `- **${sanitizeConfigValue(p.name, 100)}** (\`${sanitizeConfigValue(p.file_path, 200)}\`): ` +
        `${p.variant_count} variants` +
        (p.size_count ? `, ${p.size_count} sizes` : "") +
        `, ~${p.consumers} consumers` +
        ` — approach: ${sanitizeConfigValue(p.variant_approach, 100)}`
      );
    }
  }

  // Variant system
  lines.push("");
  lines.push("### Variant System");
  lines.push(`- **Approach:** ${sanitizeConfigValue(spec.variant_system.approach, 100)}`);
  if (spec.variant_system.libraries.length > 0) {
    lines.push(`- **Libraries:** ${spec.variant_system.libraries.map(l => sanitizeConfigValue(l, 100)).join(", ")}`);
  }

  // Show concrete examples of how to add variants
  if (spec.variant_system.examples.length > 0) {
    lines.push("");
    lines.push("### How to Add a Variant (follow these patterns)");
    for (const ex of spec.variant_system.examples.slice(0, 3)) {
      lines.push(
        `- **${sanitizeConfigValue(ex.component, 100)}** (\`${sanitizeConfigValue(ex.file_path, 200)}\`): ` +
        `${sanitizeConfigValue(ex.pattern, 300)} — ` +
        `existing variants: ${ex.variants.map(v => sanitizeConfigValue(v, 50)).join(", ")}`
      );
    }
  }

  // Theming
  if (spec.theming.approach !== "none") {
    lines.push("");
    lines.push("### Theming");
    lines.push(`- **Approach:** ${sanitizeConfigValue(spec.theming.approach, 100)}`);
    if (spec.theming.token_file) {
      lines.push(`- **Token file:** \`${sanitizeConfigValue(spec.theming.token_file, 200)}\``);
    }
    if (spec.theming.color_system) {
      lines.push(`- **Color system:** ${sanitizeConfigValue(spec.theming.color_system, 200)}`);
    }
  }

  // Naming conventions
  lines.push("");
  lines.push("### Component Naming Conventions");
  lines.push(`- **Files:** ${sanitizeConfigValue(spec.naming_conventions.files, 100)}`);
  lines.push(`- **Components:** ${sanitizeConfigValue(spec.naming_conventions.components, 100)}`);
  lines.push(`- **Props:** ${sanitizeConfigValue(spec.naming_conventions.props, 100)}`);
  lines.push(`- **CSS classes:** ${sanitizeConfigValue(spec.naming_conventions.css_classes, 100)}`);

  return lines.join("\n");
}
