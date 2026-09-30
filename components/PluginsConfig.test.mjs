import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const source = await readFile(new URL("./PluginsConfig.tsx", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { packagesToSwitch } = await jiti.import("./PluginsConfig.tsx");

const packages = [
  { source: "npm:global-on", scope: "global", disabled: false },
  { source: "npm:global-off", scope: "global", disabled: true },
  { source: "npm:project-on", scope: "project", disabled: false },
];

test("bulk buttons target every scope's packages that would change", () => {
  assert.deepEqual(packagesToSwitch(packages, true).map((pkg) => pkg.source), ["npm:global-off"]);
  assert.deepEqual(packagesToSwitch(packages, false).map((pkg) => pkg.source), ["npm:global-on", "npm:project-on"]);
  assert.deepEqual(packagesToSwitch(packages.filter((pkg) => !pkg.disabled), true), []);
});

test("the panel sends one request naming each package and its scope", () => {
  assert.match(source, /packages: targets\.map\(\(\{ source, scope \}\) => \(\{ source, scope \}\)\)/);
  assert.match(source, /setBusyKey\(`bulk:\$\{action\}`\)/);
  // The open package's controls wait for the bulk run like for their own action.
  assert.match(source, /const busy = \(busyKey\?\.endsWith\(key\) \|\| busyKey\?\.startsWith\("bulk:"\)\) \?\? false;/);
  assert.match(source, /disabled=\{footerBusy \|\| packagesToSwitch\(packages, true\)\.length === 0\}/);
  assert.match(source, /disabled=\{footerBusy \|\| packagesToSwitch\(packages, false\)\.length === 0\}/);
});

test("a bulk run confirms like the package switch and asks for a reload in an open session", () => {
  assert.match(source, /setActionMessage\(sessionId \? `\$\{message\} \$\{t\("agents\.reloadRequired"\)\}` : message\)/);
  assert.match(source, /t\("plugins\.bulkFailed", \{ count: failures\.length, total: results\.length \}\)/);
});
