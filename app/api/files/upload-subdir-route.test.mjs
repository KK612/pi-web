import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// The allowed roots come from the session catalogue, so point it at an empty
// scratch agent directory instead of the user's real ~/.pi/agent.
const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-upload-subdir-")));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = path.join(base, "agent");
fs.mkdirSync(process.env.PI_CODING_AGENT_DIR);

test.after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  fs.rmSync(base, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST } = await jiti.import("./[...path]/route.ts");
const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");
const { encodeFilePathForApi } = await jiti.import("../../../lib/file-paths.ts");
const { NextRequest } = await jiti.import("next/server");

let counter = 0;

/** A workspace that is already an allowed root, with no upload directory yet. */
function createWorkspace(t) {
  const workspace = path.join(base, `ws-${t.name.replace(/\W+/g, "-")}-${counter++}`);
  fs.mkdirSync(workspace, { recursive: true });
  allowFileRoot(workspace);
  return workspace;
}

function upload(workspace, subdir, files, search = "") {
  const encoded = encodeFilePathForApi(workspace);
  const url = `http://localhost/api/files/${encoded}?type=upload&conflict=overwrite${search}`;
  const context = { params: Promise.resolve({ path: encoded.split("/").map(decodeURIComponent) }) };
  const form = new FormData();
  for (const [name, body] of Object.entries(files)) {
    form.append("files", new File([body], name), name);
  }
  const init = { method: "POST", headers: { host: "localhost" }, body: form };
  return POST(new NextRequest(subdir ? `${url}&subdir=${encodeURIComponent(subdir)}` : url, init), context);
}

test("uploads land in .pi-web/uploads by default and create it on demand", async (t) => {
  const workspace = createWorkspace(t);
  assert.equal(fs.existsSync(path.join(workspace, ".pi-web")), false);

  const response = await upload(workspace, null, { "notes.txt": "hello" });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).uploaded, ["notes.txt"]);
  assert.equal(fs.readFileSync(path.join(workspace, ".pi-web", "uploads", "notes.txt"), "utf8"), "hello");
});

test("an explicit subdirectory is honoured", async (t) => {
  const workspace = createWorkspace(t);

  const response = await upload(workspace, "docs/reference", { "api.md": "# api" });
  assert.equal(response.status, 200);
  assert.equal(fs.readFileSync(path.join(workspace, "docs", "reference", "api.md"), "utf8"), "# api");
});

test("a subdirectory that climbs out of the workspace is refused", async (t) => {
  const workspace = createWorkspace(t);

  for (const subdir of ["..", "../..", "docs/../../..", "docs/..", "./.."]) {
    const response = await upload(workspace, subdir, { "escape.txt": "no" });
    assert.equal(response.status, 400, `expected 400 for ${subdir}`);
  }
  // An absolute path and a drive-qualified one are not relative subdirectories.
  assert.equal((await upload(workspace, base, { "escape.txt": "no" })).status, 400);
  assert.equal((await upload(workspace, "C:\\Windows", { "escape.txt": "no" })).status, 400);
  assert.equal((await upload(workspace, "/etc", { "escape.txt": "no" })).status, 400);

  assert.equal(fs.existsSync(path.join(base, "escape.txt")), false);
  assert.equal(fs.readdirSync(workspace).length, 0);
});

test("a subdirectory symlinked out of the workspace is refused", async (t) => {
  const workspace = createWorkspace(t);
  const outside = path.join(base, `outside-${t.name.replace(/\W+/g, "-")}`);
  fs.mkdirSync(outside);
  // Deliberately not an allowed root: the point is that a link out of the
  // workspace does not become writable just by being named in the query.
  const dirType = process.platform === "win32" ? "junction" : "dir";
  try {
    fs.symlinkSync(outside, path.join(workspace, "escape"), dirType);
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("Creating symbolic links requires additional privileges on this platform");
      return;
    }
    throw error;
  }

  const response = await upload(workspace, "escape", { "stolen.txt": "no" });
  assert.equal(response.status, 403);
  assert.equal(fs.readdirSync(outside).length, 0);
});

test("upload-check inspects the same subdirectory the upload would write to", async (t) => {
  const workspace = createWorkspace(t);
  fs.mkdirSync(path.join(workspace, ".pi-web", "uploads"), { recursive: true });
  fs.writeFileSync(path.join(workspace, ".pi-web", "uploads", "taken.txt"), "existing");

  const encoded = encodeFilePathForApi(workspace);
  const url = `http://localhost/api/files/${encoded}?type=upload-check&subdir=${encodeURIComponent(".pi-web/uploads")}`;
  const context = { params: Promise.resolve({ path: encoded.split("/").map(decodeURIComponent) }) };
  const init = {
    method: "POST",
    headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ fileNames: ["taken.txt", "free.txt"] }),
  };

  const response = await POST(new NextRequest(url, init), context);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).conflicts, ["taken.txt"]);
});