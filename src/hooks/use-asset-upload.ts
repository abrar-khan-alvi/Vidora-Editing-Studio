"use client";

import { useState, useCallback } from "react";
import { useAssetsStore, type ProjectFile } from "@/stores/assets-store";
import { getPresignedConfig, uploadFileWithConfig, LocalModeError } from "@/lib/upload-utils";
import { saveToOpfs } from "@/lib/opfs-storage";
import { generateVideoProxy } from "@/lib/proxy-generator";
import { generateThumbnail } from "@/lib/thumbnail-generator";
import { analyzeVideo } from "@/lib/video-analysis";

export type MediaType = "image" | "video" | "audio";

interface UploadResult {
  success: boolean;
  fileName: string;
  error?: string;
}

interface UseAssetUploadOptions {
  spaceId: string | null;
  onComplete?: () => void;
}

async function getAudioDuration(file: File): Promise<number | undefined> {
  if (typeof window === "undefined") return undefined;
  return new Promise((resolve) => {
    const audio = new window.Audio();
    audio.src = URL.createObjectURL(file);
    audio.onloadedmetadata = () => {
      resolve(audio.duration);
      URL.revokeObjectURL(audio.src);
    };
    audio.onerror = () => resolve(undefined);
  });
}

export function useAssetUpload({ spaceId, onComplete }: UseAssetUploadOptions) {
  const [isUploading, setIsUploading] = useState(false);
  const { addFiles, updateFile } = useAssetsStore();

  const detectFileType = (file: File): MediaType => {
    const mime = file.type.toLowerCase();
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (mime.startsWith("audio/") || ["mp3", "wav", "ogg", "flac", "aac", "m4a"].includes(ext))
      return "audio";
    if (mime.startsWith("video/") || ["mp4", "webm", "mov", "avi", "mkv"].includes(ext))
      return "video";
    return "image";
  };

  const createTempFile = (file: File, spaceId: string): ProjectFile => ({
    id: `temp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    spaceId,
    name: file.name,
    type: detectFileType(file),
    src: "",
    duration: undefined,
    size: file.size,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    indexingStatus: null,
    uploadProgress: 0,
  });

  // Generates the preview proxy after upload completes. Updates the asset's
  // indexing fields for progress UI, saves the proxy to OPFS and records its
  // opfs:// ref both in-memory and in the persisted localStorage entry.
  const generateProxyInBackground = (file: File, assetId: string, targetSpaceId: string) => {
    (async () => {
      updateFile(assetId, {
        indexingStatus: "processing",
        indexingStage: "optimizing_for_preview",
        indexingProgress: 0,
      });
      try {
        const proxyBlob = await generateVideoProxy(file, (p) => {
          updateFile(assetId, { indexingProgress: Math.round(p * 100) });
        });
        if (proxyBlob) {
          const proxyName = `proxy_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}.mp4`;
          const proxySrc = await saveToOpfs(proxyName, proxyBlob);
          updateFile(assetId, { proxySrc });

          const localKey = `ov_assets_${targetSpaceId}`;
          const stored = localStorage.getItem(localKey);
          if (stored) {
            const assets = JSON.parse(stored);
            const idx = assets.findIndex((a: any) => a.id === assetId);
            if (idx !== -1) {
              assets[idx].proxySrc = proxySrc;
              localStorage.setItem(localKey, JSON.stringify(assets));
            }
          }
        }
      } catch (e) {
        console.warn("Proxy generation failed:", e);
      } finally {
        updateFile(assetId, {
          indexingStatus: null,
          indexingStage: null,
          indexingProgress: null,
        });
      }
    })();
  };

  const processFile = async (file: File, tempId: string): Promise<UploadResult> => {
    const type = detectFileType(file);
    let currentId = tempId;
    const targetSpaceId = spaceId || "guest";

    try {
      // Step 1: Analyze + thumbnail + presign
      const videoInfoPromise = type === "video" ? analyzeVideo(file) : Promise.resolve(undefined);
      const audioDurationPromise = type === "audio" ? getAudioDuration(file) : Promise.resolve(undefined);
      const thumbnailPromise = generateThumbnail(file).catch(() => null);

      let videoInfo;
      let audioDuration;
      let thumbnailBlob: Blob | null = null;
      let uploadConfig: any = null;
      let thumbnailUploadConfig: any = null;

      try {
        const [vi, ad, tb, uc] = await Promise.all([
          videoInfoPromise,
          audioDurationPromise,
          thumbnailPromise,
          getPresignedConfig(file.name),
        ]);
        videoInfo = vi;
        audioDuration = ad;
        thumbnailBlob = tb;
        uploadConfig = uc;

        if (thumbnailBlob) {
          const thumbName = `thumb_${file.name.replace(/\.[^.]+$/, "")}.webp`;
          thumbnailUploadConfig = await getPresignedConfig(thumbName).catch(() => null);
        }
      } catch (e) {
        if (!(e instanceof LocalModeError)) {
          console.warn("Could not get presigned config from server (running in local offline mode):", e);
        }
        // Fallback: persist the file in the browser's OPFS so it survives
        // page reloads, and use a session object URL for playback. When OPFS
        // is unavailable the asset stays session-only (plain blob URL).
        videoInfo = await videoInfoPromise;
        audioDuration = await audioDurationPromise;
        thumbnailBlob = await thumbnailPromise;

        const baseName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const opfsSrc = await saveToOpfs(baseName, file).catch(() => null);
        const localUrl = URL.createObjectURL(file);
        const localThumbUrl = thumbnailBlob ? URL.createObjectURL(thumbnailBlob) : null;

        uploadConfig = {
          fileName: file.name,
          filePath: file.name,
          contentType: file.type,
          presignedUrl: "", // Empty indicates local mode
          url: localUrl,
          persistUrl: opfsSrc ?? undefined,
        };

        if (localThumbUrl && thumbnailBlob) {
          const opfsThumbSrc = await saveToOpfs(`thumb_${baseName}.webp`, thumbnailBlob).catch(
            () => null,
          );
          thumbnailUploadConfig = {
            fileName: "thumbnail.webp",
            filePath: "thumbnail.webp",
            contentType: "image/webp",
            presignedUrl: "",
            url: localThumbUrl,
            persistUrl: opfsThumbSrc ?? undefined,
          };
        }
      }

      const calculatedDuration = type === "video" ? videoInfo?.duration : (type === "audio" ? audioDuration : undefined);

      // Step 3: Create asset locally.
      // For localStorage we prefer the persistent opfs:// src (resolved back
      // to an object URL on next load); blob: URLs would be dead after reload.
      const guestAssetId = crypto.randomUUID();
      const newAsset = {
        id: guestAssetId,
        spaceId: targetSpaceId,
        name: file.name,
        type,
        src: uploadConfig.persistUrl ?? uploadConfig.url,
        thumbnailSrc: thumbnailUploadConfig?.persistUrl ?? thumbnailUploadConfig?.url,
        duration: calculatedDuration,
        size: file.size,
        width: videoInfo?.width,
        height: videoInfo?.height,
        fps: videoInfo?.estimatedFps,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        indexingStatus: null,
        indexingProgress: null,
        indexingStage: null,
        indexingError: null,
      };
      currentId = guestAssetId;

      // Step 4: Update temp file with real ID
      updateFile(tempId, {
        id: currentId,
        src: uploadConfig.url,
        persistSrc: uploadConfig.persistUrl ?? null,
        thumbnailSrc: thumbnailUploadConfig?.url ?? null,
        duration: calculatedDuration,
        width: videoInfo?.width,
        height: videoInfo?.height,
        uploadProgress: 0,
        indexingStatus: null,
        indexingStage: null,
        indexingProgress: null,
        indexingError: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Step 5: Upload file + thumbnail to R2 if presignedUrl is present
      if (uploadConfig.presignedUrl) {
        await Promise.all([
          uploadFileWithConfig(file, uploadConfig, (progress) => {
            updateFile(currentId, { uploadProgress: progress });
          }),
          thumbnailBlob && thumbnailUploadConfig?.presignedUrl
            ? uploadFileWithConfig(
                new File([thumbnailBlob], "thumbnail.webp", { type: "image/webp" }),
                thumbnailUploadConfig,
              ).catch(() => null)
            : Promise.resolve(),
        ]);
      } else {
        // Local simulation progress
        updateFile(currentId, { uploadProgress: 100 });
      }

      // Step 6: Clear progress and save to localStorage
      updateFile(currentId, {
        uploadProgress: null,
        indexingStatus: null,
      });

      // Save to localStorage
      const localKey = `ov_assets_${targetSpaceId}`;
      const stored = localStorage.getItem(localKey);
      const existingAssets = stored ? JSON.parse(stored) : [];
      const updatedAssets = [newAsset, ...existingAssets];
      localStorage.setItem(localKey, JSON.stringify(updatedAssets));

      // Step 7 (background): generate a seek-friendly preview proxy for videos.
      // Clips added before it finishes simply use the original file.
      if (type === "video") {
        generateProxyInBackground(file, currentId, targetSpaceId);
      }

      return { success: true, fileName: file.name };
    } catch (error: any) {
      console.error(`[Upload] Failed for ${file.name}:`, error);
      updateFile(currentId, { uploadProgress: null, indexingStatus: "failed" });
      return { success: false, fileName: file.name, error: error.message };
    }
  };

  const uploadFiles = useCallback(
    async (files: FileList | null) => {
      const targetSpaceId = spaceId || "guest";
      if (!files?.length) return;

      setIsUploading(true);
      const fileArray = Array.from(files);

      // Create temp entries
      const tempFiles = fileArray.map((file) => createTempFile(file, targetSpaceId));
      addFiles(tempFiles);

      // Process all files
      const results = await Promise.all(
        fileArray.map((file, index) => processFile(file, tempFiles[index].id)),
      );

      setIsUploading(false);
      onComplete?.();

      return results;
    },
    [spaceId, addFiles, updateFile, onComplete],
  );

  return { uploadFiles, isUploading };
}
