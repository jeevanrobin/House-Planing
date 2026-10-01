import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generatePlan } from "./engine";
import type { Requirements } from "./types";

// Golden plans shared with the Python engine (apps/api/tests/test_engine_parity.py).
// If this fails after an intentional engine change, run `npm run parity:update`
// and port the change to apps/api/app/services/floorplan.py.
const dir = fileURLToPath(new URL("../../../../../fixtures/engine-parity/", import.meta.url));
const cases: { name: string; req: Requirements }[] = JSON.parse(
  readFileSync(`${dir}cases.json`, "utf8"),
);
const expected: Record<string, unknown> = JSON.parse(readFileSync(`${dir}expected.json`, "utf8"));

describe("engine parity fixtures", () => {
  it("has an expected plan for every case", () => {
    expect(Object.keys(expected).sort()).toEqual(cases.map((c) => c.name).sort());
  });

  it.each(cases.map((c) => [c.name, c.req] as const))("%s matches expected.json", (name, req) => {
    // JSON round-trip drops `undefined` fields, matching how the fixture was written.
    expect(JSON.parse(JSON.stringify(generatePlan(req)))).toEqual(expected[name]);
  });
});
