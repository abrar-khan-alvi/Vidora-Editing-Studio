/**
 * Origin Private File System (OPFS) storage for local-mode uploads.
 *
 * When the server has no cloud storage configured, uploaded files are kept in
 * the browser's private file system so they survive page reloads. Assets are
 * persisted to localStorage with an `opfs://<name>` src, which is resolved to
 * a fresh object URL each session via `loadFromOpfs`.
 */

const OPFS_DIR = "ov-uploads";
const OPFS_PREFIX = "opfs://";

export function isOpfsSrc(src: string | null | undefined): src is string {
  return !!src && src.startsWith(OPFS_PREFIX);
}

function opfsFileName(src: string): string {
  return src.slice(OPFS_PREFIX.length);
}

async function getUploadsDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_DIR, { create: true });
}

/** Saves a blob into OPFS and returns its persistent `opfs://` src. */
export async function saveToOpfs(name: string, blob: Blob): Promise<string> {
  const dir = await getUploadsDir();
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return `${OPFS_PREFIX}${name}`;
}

/**
 * Resolves an `opfs://` src to a session object URL.
 * Returns null when the file no longer exists (e.g. browser storage cleared).
 *
 * The file content is copied into an in-memory Blob rather than using the
 * OPFS-backed File directly: object URLs backed by file snapshots can start
 * failing fetch() with "Failed to fetch" when the underlying storage state
 * changes, while memory-backed blobs stay valid for the document's lifetime.
 */
export async function loadFromOpfs(src: string): Promise<string | null> {
  try {
    const name = opfsFileName(src);
    const dir = await getUploadsDir();
    const handle = await dir.getFileHandle(name);
    const file = await handle.getFile();
    const buffer = await file.arrayBuffer();
    const type = file.type || guessMimeType(name);
    return URL.createObjectURL(new Blob([buffer], { type }));
  } catch {
    return null;
  }
}

function guessMimeType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    flac: "audio/flac",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
  };
  return map[ext] || "";
}

/** Deletes an `opfs://` file. Missing files are ignored. */
export async function deleteFromOpfs(src: string): Promise<void> {
  try {
    const dir = await getUploadsDir();
    await dir.removeEntry(opfsFileName(src));
  } catch {
    // Already gone or OPFS unavailable — nothing to clean up.
  }
}
