import { encodeFilePathForApi } from "./file-paths";

/**
 * Client-side counterpart to `lib/file-upload.ts`.
 *
 * `lib/file-upload.ts` imports `fs`/`path` and can only run on the server, so the
 * browser half of the upload lives here. `lib/file-upload.ts` owns the wire format
 * (conflict strategies, `UploadTargetInspection`) and the route validates against
 * that; this file only speaks HTTP.
 */

export type UploadConflictStrategy = "error" | "overwrite" | "skip";

export interface UploadFileResult {
  uploaded: string[];
  skipped: string[];
  errors: Array<{ name: string; error: string }>;
}

/** Where non-image attachments land inside a workspace, relative to its cwd. */
export const WORKSPACE_UPLOAD_SUBDIR = ".pi-web/uploads";

/** Same 25MB single-file ceiling the route enforces, checked before the request. */
export const MAX_UPLOAD_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Uploads `files` into `<cwd>/<subdir>`.
 *
 * `strategy` defaults to `overwrite` rather than `error` because this directory is
 * scratch space owned by pi-web: dropping the same filename twice should replace
 * the earlier copy instead of failing the whole batch with a 409.
 */
export async function uploadFilesToWorkspace(
  cwd: string,
  files: File[],
  strategy: UploadConflictStrategy = "overwrite",
  options: { subdir?: string; onProgress?: (percent: number) => void } = {},
): Promise<UploadFileResult> {
  if (!files.length) return { uploaded: [], skipped: [], errors: [] };

  const formData = new FormData();
  for (const file of files) formData.append("files", file, file.name);

  const query = new URLSearchParams({ type: "upload", conflict: strategy });
  if (options.subdir) query.set("subdir", options.subdir);

  return new Promise<UploadFileResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/files/${encodeFilePathForApi(cwd)}?${query.toString()}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        options.onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onerror = () => reject(new Error("Network error while uploading files"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.onload = () => {
      let data: Partial<UploadFileResult> & { error?: string } = {};
      try {
        data = JSON.parse(xhr.responseText) as Partial<UploadFileResult> & { error?: string };
      } catch {
        if (xhr.responseText) data.error = xhr.responseText;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(data.error ?? `Upload failed (HTTP ${xhr.status})`));
        return;
      }
      resolve({
        uploaded: data.uploaded ?? [],
        skipped: data.skipped ?? [],
        errors: data.errors ?? [],
      });
    };
    xhr.send(formData);
  });
}

/** The `@`-mention a composer should insert for an uploaded file. */
export function uploadMentionPath(fileName: string, subdir: string = WORKSPACE_UPLOAD_SUBDIR): string {
  return `@${subdir}/${fileName}`;
}