import { execFile } from "child_process";

// ============================================================================
// Which directory entries the file tree lists.
//
// Inside a Git work tree the repository decides: an entry is hidden only when
// Git ignores it, so a tracked `build/` or `dist/` stays browsable (#677).
// Where Git has no view of a directory, a fixed list of conventionally
// generated names stands in for a .gitignore. `.git` and Finder's `.DS_Store`
// are hidden either way, as in VS Code's default excludes.
//
// This is visibility only. Hidden entries stay readable through /api/files,
// which authorizes by allowed root and never consults this module.
// ============================================================================

const HIDDEN_NAMES = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".turbo", ".cache", "coverage", ".pytest_cache", ".mypy_cache",
  "target", "vendor", ".DS_Store",
]);

const HIDDEN_SUFFIXES = [".pyc"];

// The listing waits on git, so a slow one degrades to the name list rather
// than stalling the tree.
// Never worth listing, whatever a repository says about them.
const ALWAYS_HIDDEN_NAMES = new Set([".git", ".DS_Store"]);

const GIT_TIMEOUT_MS = 5_000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;

/** The name-based rule for directories no Git work tree covers. */
export function isHiddenOutsideGit(name: string): boolean {
  return HIDDEN_NAMES.has(name) || HIDDEN_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/**
 * Ask Git which of `names` (entries of `directory`) it ignores, with one
 * `git check-ignore` process however many entries there are.
 *
 * check-ignore already answers the tracked cases: it never reports a tracked
 * file, nor a directory holding a tracked file, even under a matching pattern.
 * It reads the index and the ignore files above `directory` without walking
 * the work tree, so the cost does not grow with the size of the checkout.
 * Only bare names cross the process boundary, so git's POSIX-style paths
 * never need converting back.
 *
 * Resolves null when Git has no view of `directory`: outside a work tree
 * (including inside `.git`), when git is missing, fails or times out, and when
 * `directory` is itself ignored with nothing tracked below it. That last case
 * is a scratch directory under a repository that ignores `*`, which would
 * otherwise list as empty.
 */
export function readGitIgnoredNames(
  directory: string,
  names: readonly string[],
): Promise<Set<string> | null> {
  // `./` keeps a name such as `:(glob)x` from parsing as pathspec magic, which
  // check-ignore rejects for the whole batch. `.` asks about `directory`.
  const input = [".", ...names.map((name) => `./${name}`)]
    .map((entry) => `${entry}\0`)
    .join("");

  return new Promise((resolve) => {
    const child = execFile(
      "git",
      // Reading the index runs a repository-configured fsmonitor hook, and
      // expanding a folder (a nested checkout, say) must not execute commands.
      ["-C", directory, "-c", "core.fsmonitor=false", "check-ignore", "-z", "--stdin"],
      { timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER, env: { ...process.env, LC_ALL: "C" } },
      (error, stdout) => {
        // Exit status 1 means nothing is ignored: an answer, not a failure.
        if (error && error.code !== 1) {
          resolve(null);
          return;
        }
        const ignored = new Set<string>();
        for (const record of stdout.split("\0")) {
          if (record === ".") {
            resolve(null);
            return;
          }
          if (record.startsWith("./")) ignored.add(record.slice(2));
        }
        resolve(ignored);
      },
    );
    // Outside a repository git exits without reading its input; the resulting
    // EPIPE must not surface as an unhandled stream error.
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  });
}

/** Build the visibility test for one listing of `directory`. */
export async function getFileTreeVisibility(
  directory: string,
  names: readonly string[],
): Promise<(name: string) => boolean> {
  const candidates = names.filter((name) => !ALWAYS_HIDDEN_NAMES.has(name));
  const ignored = candidates.length > 0 ? await readGitIgnoredNames(directory, candidates) : null;
  if (!ignored) return (name) => !isHiddenOutsideGit(name);
  return (name) => !ALWAYS_HIDDEN_NAMES.has(name) && !ignored.has(name);
}
