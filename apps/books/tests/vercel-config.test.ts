/**
 * vercel.json is schema-validated by Vercel, and rejects anything it does not
 * recognise: `additionalProperties: false`.
 *
 * A `"//"` comment key — which is legal JSON and a common convention — failed
 * every deployment with "should NOT have additional property `//`", after the
 * commit had merged and CI had gone green. Nothing else in this repo catches a
 * config file that only the build platform reads, so this does.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CONFIGS = ["../vercel.json", "../../admin/vercel.json"];

for (const relative of CONFIGS) {
  const path = fileURLToPath(new URL(relative, import.meta.url));

  test(`${relative} is valid JSON with no comment keys`, () => {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    for (const key of Object.keys(parsed)) {
      assert.ok(
        /^\$?[a-zA-Z][a-zA-Z0-9]*$/.test(key),
        `"${key}" is not a property Vercel knows. Comments belong in CLAUDE.md; ` +
          "vercel.json rejects anything outside its schema and the deployment fails.",
      );
    }
  });

  test(`${relative} still builds and migrates`, () => {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
    assert.match(parsed.buildCommand ?? "", /db:migrate/, "the schema is applied at build time");
    assert.match(parsed.buildCommand ?? "", /build/);
  });
}
