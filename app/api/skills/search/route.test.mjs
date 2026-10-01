import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const route = await jiti.import("./route.ts");

// skills.sh answers a renamed slug beside the stale one it replaced, so one
// installable `source@name` comes back twice. It reached the composer as two rows
// with the same skill name, which React rejects as a duplicate key.
async function search(query, installCount) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ skills: installCount(query) }),
  });
  try {
    const response = await route.POST(new Request("http://localhost/api/skills/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
    }));
    assert.equal(response.status, 200);
    return (await response.json()).results;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("a package listed under two slugs is returned once", async () => {
  const results = await search("ui-ux-pro-max", () => [
    { id: "owner/repo/design-system", name: "design-system", source: "owner/repo", installs: 33_257 },
    { id: "owner/repo/ckmdesign-system", name: "design-system", source: "owner/repo", installs: 32_885 },
  ]);

  assert.equal(results.length, 1);
  assert.equal(results[0].package, "owner/repo@design-system");
});

test("the surviving row of a duplicated package is the most installed one", async () => {
  // The renamed slug is the more-installed entry, so it is also the one whose url
  // points at the current page rather than the stale one.
  const results = await search("ui-ux-pro-max", () => [
    { id: "owner/repo/ckmdesign-system", name: "design-system", source: "owner/repo", installs: 32_885 },
    { id: "owner/repo/design-system", name: "design-system", source: "owner/repo", installs: 33_257 },
  ]);

  assert.equal(results.length, 1);
  assert.equal(results[0].installs, formatInstalls(33_257));
  assert.equal(results[0].url, "https://skills.sh/owner/repo/design-system");
});

test("distinct names in one repo are all kept", async () => {
  const results = await search("ui-ux-pro-max", () => [
    { id: "owner/repo/design-system", name: "design-system", source: "owner/repo", installs: 33_257 },
    { id: "owner/repo/ckm-design-system", name: "ckm-design-system", source: "owner/repo", installs: 367 },
  ]);

  assert.deepEqual(results.map((r) => r.package), [
    "owner/repo@design-system",
    "owner/repo@ckm-design-system",
  ]);
});

test("the same name under different repos stays separate", async () => {
  const results = await search("design-system", () => [
    { id: "owner-a/repo/design", name: "design", source: "owner-a/repo", installs: 100 },
    { id: "owner-b/repo/design", name: "design", source: "owner-b/repo", installs: 200 },
  ]);

  assert.equal(results.length, 2);
  assert.deepEqual(results.map((r) => r.package), ["owner-b/repo@design", "owner-a/repo@design"]);
});

test("deduped rows keep the install-count order", async () => {
  const results = await search("ui-ux-pro-max", () => [
    { id: "owner/repo/a", name: "a", source: "owner/repo", installs: 10 },
    { id: "owner/repo/a-stale", name: "a", source: "owner/repo", installs: 5 },
    { id: "owner/repo/b", name: "b", source: "owner/repo", installs: 20 },
  ]);

  assert.deepEqual(results.map((r) => r.package), ["owner/repo@b", "owner/repo@a"]);
});

test("every returned package is unique", async () => {
  const results = await search("ui-ux-pro-max", () => {
    const skills = [];
    for (let i = 0; i < 8; i += 1) {
      skills.push({ id: `owner/repo/skill-${i}`, name: `skill-${i}`, source: "owner/repo", installs: 1000 - i });
      // Every skill is also listed under a stale slug, which is what produced the
      // duplicate-key warnings.
      skills.push({ id: `owner/repo/ckmskill-${i}`, name: `skill-${i}`, source: "owner/repo", installs: 900 - i });
    }
    return skills;
  });

  assert.equal(results.length, 8);
  assert.equal(new Set(results.map((r) => r.package)).size, results.length);
});

function formatInstalls(count) {
  if (!count || count <= 0) return "";
  if (count >= 1_000_000) {
    const millions = (count / 1_000_000).toFixed(1).replace(/\.0$/, "");
    return `${millions}M installs`;
  }
  if (count >= 1_000) {
    const thousands = (count / 1_000).toFixed(1).replace(/\.0$/, "");
    return `${thousands}K installs`;
  }
  return `${count} install${count === 1 ? "" : "s"}`;
}