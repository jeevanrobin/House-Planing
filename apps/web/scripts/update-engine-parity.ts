/**
 * Regenerates fixtures/engine-parity/expected.json from the TypeScript engine.
 *
 * The TS engine is the source of truth (it renders the plan in the browser);
 * the Python port in apps/api must reproduce this output. Run after any
 * intentional engine change, then port the change to Python until
 * `pytest tests/test_engine_parity.py` passes:
 *
 *   npm run parity:update
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generatePlan } from "../src/lib/floorplan/engine";
import type { Requirements } from "../src/lib/floorplan/types";

const dir = fileURLToPath(new URL("../../../fixtures/engine-parity/", import.meta.url));
const cases: { name: string; req: Requirements }[] = JSON.parse(
  readFileSync(`${dir}cases.json`, "utf8"),
);

const expected = Object.fromEntries(cases.map((c) => [c.name, generatePlan(c.req)]));
writeFileSync(`${dir}expected.json`, JSON.stringify(expected, null, 1) + "\n");
console.log(`Wrote ${cases.length} plans to fixtures/engine-parity/expected.json`);
