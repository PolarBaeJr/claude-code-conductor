import type { FlowConfig, ProjectProfile } from "./types.js";
import { DEFAULT_FLOW_CONFIG } from "./flow-config.js";

/**
 * Generate a framework-specific flow config based on the detected project profile.
 * Uses templates for known frameworks and falls back to DEFAULT_FLOW_CONFIG.
 */
export function generateFlowConfig(profile: ProjectProfile): FlowConfig {
  const frameworks = profile.frameworks;

  if (frameworks.includes("nextjs")) {
    return NEXTJS_CONFIG;
  }

  if (frameworks.includes("react") && !frameworks.includes("nextjs")) {
    return REACT_SPA_CONFIG;
  }

  if (frameworks.includes("vue")) {
    return VUE_CONFIG;
  }

  if (frameworks.includes("svelte")) {
    return SVELTE_CONFIG;
  }

  if (frameworks.includes("angular")) {
    return ANGULAR_CONFIG;
  }

  // API-only frameworks
  if (
    frameworks.includes("express") ||
    frameworks.includes("fastify") ||
    frameworks.includes("hono") ||
    frameworks.includes("koa") ||
    frameworks.includes("nestjs")
  ) {
    return NODE_API_CONFIG;
  }

  if (
    frameworks.includes("fastapi") ||
    frameworks.includes("django") ||
    frameworks.includes("flask")
  ) {
    return PYTHON_API_CONFIG;
  }

  return { ...DEFAULT_FLOW_CONFIG };
}

// ============================================================
// Framework-specific templates
// ============================================================

const NEXTJS_CONFIG: FlowConfig = {
  layers: [
    {
      name: "Pages & Layouts (App Router)",
      checks: [
        "Does the page/layout handle loading and error states?",
        "Are server components used where appropriate (no client-only APIs)?",
        "Is metadata (title, description) set for SEO?",
        "Does the page handle authentication redirects for protected routes?",
        "Are dynamic route params validated before use?",
      ],
    },
    {
      name: "Server Actions & API Routes",
      checks: [
        "Is user input validated before processing?",
        "Are server actions properly authenticated and authorized?",
        "Do API routes return appropriate status codes?",
        "Are database operations wrapped in try/catch with proper error responses?",
        "Is revalidation (revalidatePath/revalidateTag) called after mutations?",
      ],
    },
    {
      name: "Client Components & Hooks",
      checks: [
        "Is 'use client' directive present on components using client-only APIs?",
        "Are forms handling loading, error, and success states?",
        "Is client-side state properly initialized (no hydration mismatches)?",
        "Are event handlers debounced where appropriate (search, resize)?",
        "Do useEffect hooks have proper cleanup functions?",
      ],
    },
    {
      name: "Shared UI Components",
      checks: [
        "Do components use the project's variant system (cva, etc.) instead of inline styles?",
        "Are shared primitives extended via variants, not modified directly?",
        "Is accessibility maintained (keyboard nav, ARIA, semantic HTML)?",
        "Are components responsive across breakpoints?",
      ],
    },
    {
      name: "Database & Data Layer",
      checks: [
        "Are queries parameterized (no SQL injection)?",
        "Do list queries use pagination?",
        "Are N+1 queries avoided (use joins/includes)?",
        "Are migrations reversible?",
        "Are indexes present for filtered/sorted columns?",
      ],
    },
    {
      name: "Cross-Boundary",
      checks: [
        "Does data flow correctly from server components through to client components?",
        "Are RSC serialization boundaries respected (no functions/classes passed as props)?",
        "Is the cache invalidation strategy consistent across related mutations?",
        "Do error boundaries catch and display errors at appropriate granularity?",
      ],
    },
  ],
  actor_types: [
    "owner",
    "admin",
    "member",
    "viewer",
    "anonymous",
    "unauthenticated",
    "server_component",
    "server_action",
    "cron_job",
  ],
  edge_cases: [
    "Hydration mismatch (server vs client render)",
    "RSC serialization boundary violations",
    "Stale cache after mutation",
    "Concurrent form submissions",
    "Token expiry during server action",
    "Pagination boundary (> 100 items)",
    "Empty state (no data)",
    "Network failure during server action",
    "Unauthorized access to protected page",
    "Missing or invalid dynamic route params",
  ],
  example_flows: [],
};

const REACT_SPA_CONFIG: FlowConfig = {
  layers: [
    {
      name: "UI Components & Pages",
      checks: [
        "Does the component handle loading, error, and empty states?",
        "Are shared components extended via variants, not modified directly?",
        "Is the component accessible (keyboard nav, ARIA)?",
        "Are forms validated before submission?",
      ],
    },
    {
      name: "State Management & Hooks",
      checks: [
        "Is state scoped to the appropriate level (local vs global)?",
        "Are side effects properly cleaned up in useEffect?",
        "Is derived state computed during render, not in useEffect?",
        "Are expensive computations memoized only when needed?",
      ],
    },
    {
      name: "API Client & Data Fetching",
      checks: [
        "Are API calls cancellable on component unmount?",
        "Is error handling consistent across API calls?",
        "Are loading states shown during fetches?",
        "Is authentication token refreshed automatically?",
      ],
    },
    {
      name: "Routing & Navigation",
      checks: [
        "Are protected routes redirecting unauthenticated users?",
        "Do route params get validated before use?",
        "Is navigation state preserved across route changes?",
      ],
    },
  ],
  actor_types: ["owner", "admin", "member", "viewer", "anonymous", "unauthenticated"],
  edge_cases: [
    "Component unmount during pending API call",
    "Concurrent state updates",
    "Token expiry mid-session",
    "Pagination boundary (> 100 items)",
    "Empty state (no data)",
    "Network failure during form submission",
    "Browser back/forward navigation",
  ],
  example_flows: [],
};

const VUE_CONFIG: FlowConfig = {
  layers: [
    {
      name: "Vue Components & Pages",
      checks: [
        "Does the component handle loading, error, and empty states?",
        "Are shared components extended via props/slots, not modified directly?",
        "Is the component accessible?",
        "Are v-model bindings validated?",
      ],
    },
    {
      name: "Composables & State (Pinia/Vuex)",
      checks: [
        "Is reactive state properly scoped?",
        "Are watchers cleaned up on unmount?",
        "Is computed state used instead of watchers for derived values?",
      ],
    },
    {
      name: "API Layer",
      checks: [
        "Are API calls handled with proper error states?",
        "Is authentication consistently applied?",
        "Are responses validated before use?",
      ],
    },
  ],
  actor_types: ["owner", "admin", "member", "viewer", "anonymous", "unauthenticated"],
  edge_cases: [
    "Reactivity edge cases (deep nested objects)",
    "Component lifecycle timing issues",
    "Token expiry mid-session",
    "Pagination boundary",
    "Empty state (no data)",
  ],
  example_flows: [],
};

const SVELTE_CONFIG: FlowConfig = {
  layers: [
    {
      name: "Svelte Components & Routes",
      checks: [
        "Does the component handle loading, error, and empty states?",
        "Are shared components extended via props, not modified directly?",
        "Is the component accessible?",
        "Are reactive statements ($:) used correctly?",
      ],
    },
    {
      name: "Stores & State",
      checks: [
        "Are stores properly subscribed and unsubscribed?",
        "Is derived state computed via derived stores?",
        "Are writable stores scoped appropriately?",
      ],
    },
    {
      name: "API & Data Loading",
      checks: [
        "Are load functions handling errors?",
        "Is authentication verified before loading protected data?",
        "Is form data validated in actions?",
        "Are API responses typed?",
      ],
    },
  ],
  actor_types: ["owner", "admin", "member", "viewer", "anonymous", "unauthenticated"],
  edge_cases: [
    "Reactive statement ordering",
    "Store memory leaks on navigation",
    "Token expiry mid-session",
    "Unauthorized access to protected route",
    "Empty state (no data)",
  ],
  example_flows: [],
};

const ANGULAR_CONFIG: FlowConfig = {
  layers: [
    {
      name: "Components & Templates",
      checks: [
        "Does the component handle loading, error, and empty states?",
        "Are shared components extended via @Input variants?",
        "Is the component accessible?",
        "Are template expressions simple (no complex logic)?",
        "Are reactive forms validated with Validators before submission?",
      ],
    },
    {
      name: "Services & State",
      checks: [
        "Are observables properly unsubscribed (async pipe or takeUntil)?",
        "Is state management consistent (NgRx, signals, or services)?",
        "Are services scoped to appropriate injector levels?",
      ],
    },
    {
      name: "HTTP & Interceptors",
      checks: [
        "Are HTTP errors handled consistently via interceptors?",
        "Is authentication applied via interceptors?",
        "Are responses typed with interfaces?",
      ],
    },
  ],
  actor_types: ["owner", "admin", "member", "viewer", "anonymous", "unauthenticated"],
  edge_cases: [
    "Observable memory leaks",
    "Change detection issues",
    "Token expiry mid-session",
    "Lazy-loaded module boundaries",
    "Empty state (no data)",
  ],
  example_flows: [],
};

const NODE_API_CONFIG: FlowConfig = {
  layers: [
    {
      name: "Route Handlers / Controllers",
      checks: [
        "Is input validated at the handler boundary?",
        "Are HTTP status codes semantically correct?",
        "Is authentication verified before processing?",
        "Are error responses consistent in shape?",
      ],
    },
    {
      name: "Middleware",
      checks: [
        "Is auth middleware applied to all protected routes?",
        "Are rate limiters configured for sensitive endpoints?",
        "Is request logging structured and correlation-ID-aware?",
      ],
    },
    {
      name: "Service / Business Logic",
      checks: [
        "Is business logic separated from HTTP concerns?",
        "Are transactions used for multi-step mutations?",
        "Are external service calls wrapped with error handling and timeouts?",
      ],
    },
    {
      name: "Database / Data Layer",
      checks: [
        "Are queries parameterized?",
        "Do list queries use pagination?",
        "Are N+1 queries avoided?",
        "Are indexes present for filtered/sorted columns?",
      ],
    },
  ],
  actor_types: ["owner", "admin", "member", "viewer", "service_account", "unauthenticated"],
  edge_cases: [
    "Concurrent writes to same resource",
    "Transaction rollback on partial failure",
    "Token expiry during long operation",
    "Pagination boundary (> 100 items)",
    "Missing required environment variables",
    "External service timeout",
  ],
  example_flows: [],
};

const PYTHON_API_CONFIG: FlowConfig = {
  layers: [
    {
      name: "Endpoints / Views",
      checks: [
        "Is input validated via Pydantic models or form validation?",
        "Are HTTP status codes correct?",
        "Is authentication/authorization checked?",
        "Are error responses consistent?",
      ],
    },
    {
      name: "Dependencies / Middleware",
      checks: [
        "Are dependency injection patterns consistent?",
        "Is auth applied to all protected endpoints?",
        "Are request-scoped resources cleaned up?",
      ],
    },
    {
      name: "Service / Business Logic",
      checks: [
        "Is business logic separated from endpoint handlers?",
        "Are database sessions scoped correctly?",
        "Are external API calls wrapped with error handling?",
      ],
    },
    {
      name: "Database / ORM Layer",
      checks: [
        "Are queries parameterized (no string formatting)?",
        "Do list queries use pagination?",
        "Are N+1 queries avoided (use joinedload/selectinload)?",
        "Are migrations reversible?",
      ],
    },
  ],
  actor_types: ["owner", "admin", "member", "viewer", "service_account", "unauthenticated"],
  edge_cases: [
    "Concurrent writes to same resource",
    "Database connection pool exhaustion",
    "Token expiry during async operation",
    "Pagination boundary (> 100 items)",
    "Missing environment variables",
  ],
  example_flows: [],
};
