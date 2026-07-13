export interface PresignedUploadConfig {
  fileName: string;
  filePath: string;
  contentType: string;
  presignedUrl: string;
  url: string;
}

export interface UploadResult extends PresignedUploadConfig {}

/** Thrown when the server has no cloud storage configured — triggers offline blob fallback. */
export class LocalModeError extends Error {
  constructor() {
    super("local-mode");
    this.name = "LocalModeError";
  }
}

/**
 * Fetches a presigned R2 upload config for the given file name.
 * Returns { presignedUrl, url, fileName, filePath, contentType }.
 * Throws LocalModeError when the server has no R2 credentials configured.
 */
export async function getPresignedConfig(fileName: string): Promise<PresignedUploadConfig> {
  const response = await fetch("/api/uploads/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileNames: [fileName] }),
  });

  if (!response.ok) {
    let body: any = {};
    try { body = await response.json(); } catch { /* ignore */ }
    if (body?.localMode) throw new LocalModeError();
    throw new Error("Failed to get presigned URL");
  }

  const { uploads } = await response.json();
  return uploads[0] as PresignedUploadConfig;
}

/**
 * Uploads a file to R2 using a pre-obtained presigned config.
 * Supports upload progress via XMLHttpRequest.
 */
export async function uploadFileWithConfig(
  file: File,
  config: PresignedUploadConfig,
  onProgress?: (progress: number) => void,
): Promise<PresignedUploadConfig> {
  return new Promise<PresignedUploadConfig>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", config.presignedUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

    if (onProgress) {
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          const percentage = Math.round((event.loaded / event.total) * 100);
          onProgress(percentage);
        }
      });
    }

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(config);
      } else {
        reject(new Error(`Upload failed with status: ${xhr.status}`));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Network error during upload"));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("Upload aborted"));
    });

    xhr.send(file);
  });
}

/**
 * Convenience wrapper: presigns + uploads in one call.
 * Use uploadFileWithConfig directly if you need the presigned URL
 * before uploading (e.g. to register an asset in the DB first).
 */
export const uploadFile = async (
  file: File,
  onProgress?: (progress: number) => void,
): Promise<UploadResult> => {
  const config = await getPresignedConfig(file.name);
  return uploadFileWithConfig(file, config, onProgress);
};
