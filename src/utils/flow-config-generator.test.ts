/**
 * Tests for flow-config-generator.ts
 *
 * - Framework routing logic (priority, fallback)
 * - Config structure validation for all 7 framework configs
 * - Security checks presence in all configs
 */

import { describe, expect, it } from "vitest";

import { generateFlowConfig } from "./flow-config-generator.js";
import { DEFAULT_FLOW_CONFIG } from "./flow-config.js";
import type { FlowConfig, ProjectProfile } from "./types.js";

// ============================================================
// Test fixture helper
// ============================================================

const makeProfile = (frameworks: string[]): ProjectProfile => ({
  detected_at: new Date().toISOString(),
  languages: ["typescript"],
  frameworks,
  test_runners: [],
  linters: [],
  ci_systems: [],
  package_managers: ["npm"],
});

// ============================================================
// Framework routing tests
// ============================================================

describe("generateFlowConfig – framework routing", () => {
  it("returns NEXTJS_CONFIG for nextjs profile", () => {
    const config = generateFlowConfig(makeProfile(["nextjs"]));
    expect(config.layers[0].name).toContain("App Router");
  });

  it("returns REACT_SPA_CONFIG for react (without nextjs) profile", () => {
    const config = generateFlowConfig(makeProfile(["react"]));
    expect(config.layers[0].name).toBe("UI Components & Pages");
  });

  it("returns NEXTJS_CONFIG when profile has both react and nextjs (nextjs takes priority)", () => {
    const config = generateFlowConfig(makeProfile(["react", "nextjs"]));
    expect(config.layers[0].name).toContain("App Router");
  });

  it("returns VUE_CONFIG for vue profile", () => {
    const config = generateFlowConfig(makeProfile(["vue"]));
    expect(config.layers[0].name).toBe("Vue Components & Pages");
  });

  it("returns SVELTE_CONFIG for svelte profile", () => {
    const config = generateFlowConfig(makeProfile(["svelte"]));
    expect(config.layers[0].name).toBe("Svelte Components & Routes");
  });

  it("returns ANGULAR_CONFIG for angular profile", () => {
    const config = generateFlowConfig(makeProfile(["angular"]));
    expect(config.layers[0].name).toBe("Components & Templates");
  });

  it("returns NODE_API_CONFIG for express profile", () => {
    const config = generateFlowConfig(makeProfile(["express"]));
    expect(config.layers[0].name).toBe("Route Handlers / Controllers");
  });

  it("returns NODE_API_CONFIG for fastify profile", () => {
    const config = generateFlowConfig(makeProfile(["fastify"]));
    expect(config.layers[0].name).toBe("Route Handlers / Controllers");
  });

  it("returns NODE_API_CONFIG for hono profile", () => {
    const config = generateFlowConfig(makeProfile(["hono"]));
    expect(config.layers[0].name).toBe("Route Handlers / Controllers");
  });

  it("returns NODE_API_CONFIG for koa profile", () => {
    const config = generateFlowConfig(makeProfile(["koa"]));
    expect(config.layers[0].name).toBe("Route Handlers / Controllers");
  });

  it("returns NODE_API_CONFIG for nestjs profile", () => {
    const config = generateFlowConfig(makeProfile(["nestjs"]));
    expect(config.layers[0].name).toBe("Route Handlers / Controllers");
  });

  it("returns PYTHON_API_CONFIG for fastapi profile", () => {
    const config = generateFlowConfig(makeProfile(["fastapi"]));
    expect(config.layers[0].name).toBe("Endpoints / Views");
  });

  it("returns PYTHON_API_CONFIG for django profile", () => {
    const config = generateFlowConfig(makeProfile(["django"]));
    expect(config.layers[0].name).toBe("Endpoints / Views");
  });

  it("returns PYTHON_API_CONFIG for flask profile", () => {
    const config = generateFlowConfig(makeProfile(["flask"]));
    expect(config.layers[0].name).toBe("Endpoints / Views");
  });

  it("returns DEFAULT_FLOW_CONFIG for unknown framework", () => {
    const config = generateFlowConfig(makeProfile(["unknown-framework"]));
    expect(config).toEqual({ ...DEFAULT_FLOW_CONFIG });
  });

  it("returns DEFAULT_FLOW_CONFIG for empty frameworks", () => {
    const config = generateFlowConfig(makeProfile([]));
    expect(config).toEqual({ ...DEFAULT_FLOW_CONFIG });
  });

  it("default fallback is a spread copy (not same reference)", () => {
    const config = generateFlowConfig(makeProfile([]));
    expect(config).not.toBe(DEFAULT_FLOW_CONFIG);
    expect(config).toEqual({ ...DEFAULT_FLOW_CONFIG });
  });
});

// ============================================================
// Config structure validation
// ============================================================

/**
 * Map of framework identifier → expected first layer name for identification.
 * Used both for routing tests and structural validation.
 */
const FRAMEWORK_CONFIGS: { name: string; frameworks: string[] }[] = [
  { name: "Next.js", frameworks: ["nextjs"] },
  { name: "React SPA", frameworks: ["react"] },
  { name: "Vue", frameworks: ["vue"] },
  { name: "Svelte", frameworks: ["svelte"] },
  { name: "Angular", frameworks: ["angular"] },
  { name: "Node API (Express)", frameworks: ["express"] },
  { name: "Node API (Fastify)", frameworks: ["fastify"] },
  { name: "Python API (FastAPI)", frameworks: ["fastapi"] },
  { name: "Python API (Django)", frameworks: ["django"] },
];

describe("generateFlowConfig – config structure validation", () => {
  for (const { name, frameworks } of FRAMEWORK_CONFIGS) {
    describe(`${name} config`, () => {
      let config: FlowConfig;

      // Generate config once per framework
      config = generateFlowConfig(makeProfile(frameworks));

      it("has non-empty layers array", () => {
        expect(config.layers.length).toBeGreaterThan(0);
      });

      it("each layer has a name (string) and non-empty checks array", () => {
        for (const layer of config.layers) {
          expect(typeof layer.name).toBe("string");
          expect(layer.name.length).toBeGreaterThan(0);
          expect(Array.isArray(layer.checks)).toBe(true);
          expect(layer.checks.length).toBeGreaterThan(0);
          for (const check of layer.checks) {
            expect(typeof check).toBe("string");
            expect(check.length).toBeGreaterThan(0);
          }
        }
      });

      it("has non-empty actor_types array", () => {
        expect(config.actor_types.length).toBeGreaterThan(0);
        for (const actor of config.actor_types) {
          expect(typeof actor).toBe("string");
        }
      });

      it("has non-empty edge_cases array", () => {
        expect(config.edge_cases.length).toBeGreaterThan(0);
        for (const edge of config.edge_cases) {
          expect(typeof edge).toBe("string");
        }
      });

      it("has empty example_flows array (templates don't include example flows)", () => {
        expect(config.example_flows).toEqual([]);
      });
    });
  }
});

// ============================================================
// Security checks presence
// ============================================================

describe("generateFlowConfig – security checks", () => {
  /**
   * Checks that at least one layer in the config mentions auth/authentication/authorization
   * in at least one of its checks.
   */
  function hasAuthCheck(config: FlowConfig): boolean {
    return config.layers.some((layer) =>
      layer.checks.some(
        (check) =>
          /\bauth\b/i.test(check) ||
          /\bauthenticat/i.test(check) ||
          /\bauthoriz/i.test(check),
      ),
    );
  }

  /**
   * Checks that at least one layer mentions input validation.
   */
  function hasInputValidationCheck(config: FlowConfig): boolean {
    return config.layers.some((layer) =>
      layer.checks.some(
        (check) =>
          /\bvalidat/i.test(check) ||
          /\binput\b/i.test(check) ||
          /\bparameteriz/i.test(check),
      ),
    );
  }

  for (const { name, frameworks } of FRAMEWORK_CONFIGS) {
    describe(`${name} config`, () => {
      const config = generateFlowConfig(makeProfile(frameworks));

      it("has at least one layer with auth/authentication/authorization check", () => {
        expect(hasAuthCheck(config)).toBe(true);
      });

      it("has at least one layer with input validation check", () => {
        expect(hasInputValidationCheck(config)).toBe(true);
      });
    });
  }
});

// ============================================================
// Framework-specific content validation
// ============================================================

describe("generateFlowConfig – framework-specific content", () => {
  it("Next.js config mentions Server Actions", () => {
    const config = generateFlowConfig(makeProfile(["nextjs"]));
    const layerNames = config.layers.map((l) => l.name);
    expect(layerNames.some((n) => n.includes("Server Actions"))).toBe(true);
  });

  it("Next.js config mentions RSC/hydration in edge cases", () => {
    const config = generateFlowConfig(makeProfile(["nextjs"]));
    expect(config.edge_cases.some((e) => /hydration/i.test(e))).toBe(true);
    expect(config.edge_cases.some((e) => /RSC/i.test(e))).toBe(true);
  });

  it("Next.js config has server-specific actor types", () => {
    const config = generateFlowConfig(makeProfile(["nextjs"]));
    expect(config.actor_types).toContain("server_component");
    expect(config.actor_types).toContain("server_action");
  });

  it("React SPA config mentions state management", () => {
    const config = generateFlowConfig(makeProfile(["react"]));
    const layerNames = config.layers.map((l) => l.name);
    expect(layerNames.some((n) => /state management/i.test(n))).toBe(true);
  });

  it("Vue config mentions Composables and Pinia/Vuex", () => {
    const config = generateFlowConfig(makeProfile(["vue"]));
    const layerNames = config.layers.map((l) => l.name);
    expect(layerNames.some((n) => /composable/i.test(n) || /pinia/i.test(n) || /vuex/i.test(n))).toBe(true);
  });

  it("Svelte config mentions reactive statements ($:)", () => {
    const config = generateFlowConfig(makeProfile(["svelte"]));
    const allChecks = config.layers.flatMap((l) => l.checks);
    expect(allChecks.some((c) => c.includes("$:"))).toBe(true);
  });

  it("Angular config mentions NgRx/signals", () => {
    const config = generateFlowConfig(makeProfile(["angular"]));
    const allChecks = config.layers.flatMap((l) => l.checks);
    expect(allChecks.some((c) => /ngrx/i.test(c) || /signals/i.test(c))).toBe(true);
  });

  it("Angular config mentions Validators for form validation", () => {
    const config = generateFlowConfig(makeProfile(["angular"]));
    const allChecks = config.layers.flatMap((l) => l.checks);
    expect(allChecks.some((c) => /Validators/i.test(c))).toBe(true);
  });

  it("Node API config mentions middleware layer", () => {
    const config = generateFlowConfig(makeProfile(["express"]));
    const layerNames = config.layers.map((l) => l.name);
    expect(layerNames.some((n) => /middleware/i.test(n))).toBe(true);
  });

  it("Node API config has service_account actor type", () => {
    const config = generateFlowConfig(makeProfile(["express"]));
    expect(config.actor_types).toContain("service_account");
  });

  it("Python API config mentions Pydantic", () => {
    const config = generateFlowConfig(makeProfile(["fastapi"]));
    const allChecks = config.layers.flatMap((l) => l.checks);
    expect(allChecks.some((c) => /pydantic/i.test(c))).toBe(true);
  });

  it("Python API config mentions ORM patterns (joinedload/selectinload)", () => {
    const config = generateFlowConfig(makeProfile(["fastapi"]));
    const allChecks = config.layers.flatMap((l) => l.checks);
    expect(allChecks.some((c) => /joinedload|selectinload/i.test(c))).toBe(true);
  });

  it("Python API config has service_account actor type", () => {
    const config = generateFlowConfig(makeProfile(["fastapi"]));
    expect(config.actor_types).toContain("service_account");
  });
});
