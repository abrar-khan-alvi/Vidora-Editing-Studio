"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { Log } from "@openvideo/engine-pixi";
import { useStudioStore } from "@/stores/studio-store";
import { useDownloadStore } from "@/stores/download-store";
import { generateThumbnail } from "@/lib/thumbnail-generator";
import { runExport, type ExportSettings, type ResolutionPreset } from "@/lib/export-pipeline";

export type { ExportSettings } from "@/lib/export-pipeline";

export function formatBytes(bytes?: number) {
  if (bytes === undefined || bytes === null || isNaN(bytes)) return "—";
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

function exportFileName(format: string) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  return `${stamp}.${format}`;
}

export function handleDownload(url: string, format: string) {
  const aEl = document.createElement("a");
  document.body.appendChild(aEl);
  aEl.setAttribute("href", url);
  aEl.setAttribute("download", `openvideo-export-${Date.now()}.${format}`);
  aEl.setAttribute("target", "_self");
  aEl.click();
  setTimeout(() => {
    if (document.body.contains(aEl)) document.body.removeChild(aEl);
  }, 100);
}

/**
 * Export flow used by the header Export button: runs the shared pipeline and
 * reports lifecycle/progress into the downloads store (taskbar popover).
 */
export function useExport() {
  const studio = useStudioStore((state) => state.studio);
  const addDownload = useDownloadStore((state) => state.addDownload);
  const updateDownload = useDownloadStore((state) => state.updateDownload);
  const markDownloaded = useDownloadStore((state) => state.markDownloaded);

  const startExport = useCallback(
    async (settings: ExportSettings, targetPreset?: ResolutionPreset) => {
      if (!studio) return;

      const activeFormat = targetPreset ? targetPreset.format : settings.format;
      const downloadId = addDownload({
        type: "export",
        name: exportFileName(activeFormat),
        format: activeFormat,
      });

      toast.info("Download has started");
      updateDownload(downloadId, { status: "processing" });

      try {
        const { blob, blobUrl, format } = await runExport({
          studio,
          settings,
          targetPreset,
          onProgress: (v) => updateDownload(downloadId, { progress: v }),
        });

        updateDownload(downloadId, {
          status: "completed",
          progress: 1,
          url: blobUrl,
          completedAt: Date.now(),
          name: exportFileName(format),
          size: blob.size,
        });

        handleDownload(blobUrl, format);
        markDownloaded(downloadId);
        toast.success("Rendering complete! Your download has started.");

        // Generate thumbnail in the background once the export is done
        const exportFile = new File([blob], exportFileName(format), { type: blob.type });
        generateThumbnail(exportFile)
          .then((thumbnailBlob) => {
            if (thumbnailBlob) {
              updateDownload(downloadId, {
                thumbnailUrl: URL.createObjectURL(thumbnailBlob),
              });
            }
          })
          .catch(() => undefined);
      } catch (error) {
        Log.error("Export error:", error);
        const message = (error as Error).message || "Unknown error";
        updateDownload(downloadId, { status: "failed", error: message });
        toast.error(`Export failed: ${message}`);
      }
    },
    [studio, addDownload, updateDownload, markDownloaded],
  );

  return { startExport };
}
