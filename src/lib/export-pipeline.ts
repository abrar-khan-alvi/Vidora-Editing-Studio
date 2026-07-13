import { Compositor, fontManager, type Studio } from "@openvideo/engine-pixi";
import { editorFont } from "@/components/editor/constants";
import { projectStore } from "@/lib/project";
import { isOpfsSrc, loadFromOpfs } from "@/lib/opfs-storage";

// ---------------------------------------------------------------------------
// Export option definitions (sourced from mediabunny's supported formats/codecs)
// ---------------------------------------------------------------------------

export interface ResolutionPreset {
  value: string;
  label: string;
  badge: string;
  bitrate: number;
  fps: number;
  codec: string;
  format: string;
}

export interface ExportSettings {
  includeVideo: boolean;
  videoCodec: string;
  quality: string;
  format: string;
  fps: string;
  resolution: string;
  includeAudio: boolean;
  audioCodec: string;
  audioSampleRate: string;
}

export const VIDEO_CODECS = [
  { value: "avc1.640033", label: "H.264 (AVC)", maxHeight: 2160 },
  { value: "hvc1.1.6.L153.B0", label: "H.265 (HEVC)", maxHeight: 2160 },
  { value: "vp09.00.51.08", label: "VP9", maxHeight: 2160 },
];

export const AUDIO_CODECS = [
  { value: "aac", label: "AAC" },
  { value: "opus", label: "Opus" },
  { value: "mp3", label: "MP3" },
  { value: "flac", label: "FLAC" },
];

// Which container formats work with which video codecs
export const VIDEO_FORMATS = [
  {
    value: "mp4",
    label: "MP4",
    codecs: ["avc1.640033", "hvc1.1.6.L153.B0", "vp09.00.51.08"],
  },
  { value: "webm", label: "WebM", codecs: ["vp09.00.51.08"] },
  {
    value: "mkv",
    label: "MKV",
    codecs: ["avc1.640033", "hvc1.1.6.L153.B0", "vp09.00.51.08"],
  },
  { value: "mov", label: "MOV", codecs: ["avc1.640033", "hvc1.1.6.L153.B0"] },
];

export const AUDIO_FORMATS = [
  { value: "mp3", label: "MP3" },
  { value: "wav", label: "WAV" },
  { value: "flac", label: "FLAC" },
  { value: "ogg", label: "OGG" },
];

export const FRAME_RATES = [
  { value: "23.976", label: "23.976 fps (Film)" },
  { value: "24", label: "24 fps" },
  { value: "25", label: "25 fps (PAL)" },
  { value: "29.97", label: "29.97 fps (NTSC)" },
  { value: "30", label: "30 fps" },
  { value: "50", label: "50 fps" },
  { value: "59.94", label: "59.94 fps (NTSC)" },
  { value: "60", label: "60 fps" },
  { value: "15", label: "15 fps" },
];

export const RESOLUTION_GROUPS: { group: string; items: ResolutionPreset[] }[] = [
  {
    group: "Standard",
    items: [
      {
        value: "1280x720",
        label: "HD",
        badge: "720p",
        bitrate: 7_000_000,
        fps: 30,
        codec: "avc1.640033",
        format: "mp4",
      },
      {
        value: "1920x1080",
        label: "Full HD",
        badge: "1080p",
        bitrate: 12_000_000,
        fps: 30,
        codec: "avc1.640033",
        format: "mp4",
      },
      {
        value: "2560x1440",
        label: "2K Quad HD",
        badge: "1440p",
        bitrate: 24_000_000,
        fps: 30,
        codec: "vp09.00.51.08",
        format: "mp4",
      },
      {
        value: "3840x2160",
        label: "4K Ultra HD",
        badge: "2160p",
        bitrate: 64_000_000,
        fps: 30,
        codec: "vp09.00.51.08",
        format: "mp4",
      },
    ],
  },
  {
    group: "Social Media",
    items: [
      {
        value: "1080x1920",
        label: "YouTube Shorts",
        badge: "1080p",
        bitrate: 12_000_000,
        fps: 30,
        codec: "avc1.640033",
        format: "mp4",
      },
      {
        value: "3840x2160",
        label: "YouTube 4K",
        badge: "2160p",
        bitrate: 64_000_000,
        fps: 30,
        codec: "vp09.00.51.08",
        format: "mp4",
      },
      {
        value: "1080x1920",
        label: "Instagram Reels",
        badge: "1080p",
        bitrate: 12_000_000,
        fps: 30,
        codec: "avc1.640033",
        format: "mp4",
      },
      {
        value: "1080x1920",
        label: "TikTok",
        badge: "1080p",
        bitrate: 12_000_000,
        fps: 30,
        codec: "avc1.640033",
        format: "mp4",
      },
    ],
  },
  {
    group: "Web",
    items: [
      {
        value: "1280x720",
        label: "HD",
        badge: "720p",
        bitrate: 5_000_000,
        fps: 30,
        codec: "vp09.00.51.08",
        format: "webm",
      },
      {
        value: "1920x1080",
        label: "Full HD",
        badge: "1080p",
        bitrate: 8_000_000,
        fps: 30,
        codec: "vp09.00.51.08",
        format: "webm",
      },
    ],
  },
];

export const RESOLUTION_PRESETS = RESOLUTION_GROUPS.flatMap((g) => g.items);

export const SAMPLE_RATES = [
  { value: "44100", label: "44.1 kHz" },
  { value: "48000", label: "48 kHz" },
];

// ---------------------------------------------------------------------------
// Utility: freeze the editor render loop during export so the main thread is
// fully available to the encoder. Replaces window.requestAnimationFrame with a
// version that queues callbacks instead of running them — identical to what the
// browser does naturally when the tab is backgrounded (where export runs ~2×
// faster). Returns a restore function that must be called when export finishes.
// ---------------------------------------------------------------------------

function suppressRenderLoop(): () => void {
  const originalRAF = window.requestAnimationFrame.bind(window);
  const originalCAF = window.cancelAnimationFrame.bind(window);
  const queued = new Map<number, FrameRequestCallback>();
  let idCounter = 0x70000000;

  // DOM types mark rAF/cAF as readonly; one typed cast is required.
  const win = window as Window & {
    requestAnimationFrame: (cb: FrameRequestCallback) => number;
    cancelAnimationFrame: (id: number) => void;
  };

  win.requestAnimationFrame = (cb) => {
    const id = ++idCounter;
    queued.set(id, cb);
    return id;
  };
  win.cancelAnimationFrame = (id) => {
    // Only handle IDs in our range. Pre-suppression IDs (< 0x70000000)
    // may be stale/invalid - don't try to cancel them with original RAF.
    if (id >= 0x70000000) {
      queued.delete(id);
    }
  };

  return () => {
    win.requestAnimationFrame = originalRAF;
    win.cancelAnimationFrame = originalCAF;
    queued.forEach((cb) => originalRAF(cb));
    queued.clear();
  };
}

// ---------------------------------------------------------------------------
// Shared export pipeline
// ---------------------------------------------------------------------------

export interface RunExportParams {
  studio: Studio;
  settings: ExportSettings;
  /** When set, its format/bitrate/fps/codec override the equivalent settings. */
  targetPreset?: ResolutionPreset;
  onProgress?: (progress: number) => void;
  /** Receives the compositor as soon as it exists — keep it to cancel the export. */
  onCompositor?: (compositor: Compositor) => void;
}

export interface RunExportResult {
  blob: Blob;
  blobUrl: string;
  format: string;
}

/**
 * Runs the full export: snapshots the studio, reconciles it with Core's
 * authoritative state, renders through a WebCodecs Compositor and returns the
 * finished blob. Pauses/suspends the studio for the duration and always
 * restores it. Throws on failure — callers own user-facing error handling.
 */
export async function runExport({
  studio,
  settings,
  targetPreset,
  onProgress,
  onCompositor,
}: RunExportParams): Promise<RunExportResult> {
  const activeFormat = targetPreset ? targetPreset.format : settings.format;
  const wasPlaying = studio.getIsPlaying();
  const restoreRAF = suppressRenderLoop();
  let compositor: Compositor | null = null;

  try {
    if (wasPlaying) studio.pause();
    studio.suspendRendering();

    const json = studio.exportToJSON();

    // ─── Reconcile with Core's authoritative state ────────────────────────
    // The Studio may lag behind Core after split/delete operations.
    // We filter the exported JSON so it only contains clips and tracks
    // that Core currently knows about, and we sync timing from Core.
    const coreState = projectStore.getState();
    const coreClips = coreState.clips; // Record<id, AnyClip>

    // 1. Remove clips that Core has deleted
    for (const id of Object.keys(json.clips ?? {})) {
      if (!coreClips[id]) {
        delete json.clips![id];
      } else {
        // 2. Sync timing from Core so trim/display are correct
        const coreClip = coreClips[id];
        const existing = json.clips![id] as any;
        if (coreClip.timing) {
          const display = coreClip.timing.display;
          const playbackRate = coreClip.timing.playbackRate ?? 1;
          let trim = coreClip.timing.trim;
          let duration = coreClip.timing.duration;

          // Clamp trim to exactly what the display window consumes.
          // After split/delete edits, clips can carry a stale trim.to that
          // still points at the end of the source file. The engine "fixes"
          // any duration != (trim.to - trim.from) at load time by stretching
          // display.to to the full trim length — which makes the clip's
          // audio play underneath the rest of the export (audio overlap)
          // and drives the decoder past the end of the stream.
          if (display && trim) {
            const displayLen = Math.max(0, display.to - display.from);
            const consumed = trim.from + displayLen * playbackRate;
            if (trim.to > consumed) {
              trim = { ...trim, to: consumed };
            }
            duration = displayLen;
          }

          existing.timing = {
            ...existing.timing,
            display,
            trim,
            duration,
            playbackRate,
          };
          // Also update flat fields for compatibility
          existing.display = display;
          existing.trim = trim;
          existing.duration = duration;
          existing.playbackRate = playbackRate;
        }

        // Clips edited against a preview proxy carry the original source in
        // metadata.originalSrc — swap it back in for full-quality export.
        const originalSrc = (coreClip as any).metadata?.originalSrc;
        if (originalSrc) {
          const url = isOpfsSrc(originalSrc) ? await loadFromOpfs(originalSrc) : originalSrc;
          if (url) existing.src = url;
        }
      }
    }

    // 3. Update tracks — filter clip IDs to only those still in Core
    if (json.tracks) {
      json.tracks = coreState.tracks
        .map((ct) => ({
          id: ct.id,
          name: ct.name,
          type: ct.type,
          clipIds: ct.clipIds.filter((id) => !!json.clips![id]),
        }))
        .filter((t) => t.clipIds.length > 0);
    }

    // 4. Calculate actual project duration from remaining clips
    if (json.settings) {
      let maxDuration = 0;
      for (const clipId of Object.keys(json.clips ?? {})) {
        const clip = json.clips![clipId] as any;
        const to = clip.timing?.display?.to ?? clip.display?.to ?? 0;
        if (to > maxDuration) maxDuration = to;
      }
      // fallback to core duration if empty, or at least 1us
      json.settings.duration = maxDuration > 0 ? maxDuration : coreState.settings.duration || 1;

      // BUGFIX for 4-second padding issue:
      // The Compositor outputs a video length matching the `main: true` clip's `.duration`.
      // Video clips use `.duration` to store the original source length (e.g. 4s), even if trimmed (e.g. to 3s).
      // We cannot modify the video's `.duration` directly because the PixiEngine validates `trim.to <= duration`.
      // Solution: Demote all clips to `main: false`, and inject a dummy Placeholder clip as `main: true`
      // that has the exact computed project duration.
      const dummyId = "export_dummy_main";
      json.clips![dummyId] = {
        id: dummyId,
        type: "Text",
        name: "Export Dummy",
        main: true,
        duration: json.settings.duration,
        timing: {
          display: { from: 0, to: json.settings.duration },
          trim: { from: 0, to: json.settings.duration },
          duration: json.settings.duration,
          playbackRate: 1,
        },
        transform: { x: 0, y: 0, width: 1, height: 1, angle: 0, opacity: 0, zIndex: -100 },
        opacity: 0,
        text: "",
        style: {
          fontSize: 10,
          fontFamily: "Arial",
          color: "transparent",
        },
      } as any;

      for (const clipId of Object.keys(json.clips ?? {})) {
        if (clipId !== dummyId) {
          (json.clips![clipId] as any).main = false;
        }
      }

      json.tracks = json.tracks || [];
      json.tracks.push({
        id: "export_dummy_track",
        name: "Dummy Track",
        type: "text",
        clipIds: [dummyId],
        accepts: ["text"],
      } as any);
    }
    // ─────────────────────────────────────────────────────────────────────

    if (!json.clips || Object.keys(json.clips).length === 0) {
      throw new Error("No clips to export");
    }

    const studioOpts = studio.getOptions() || {
      width: 1920,
      height: 1080,
      fps: 30,
    };
    const projectSettings = json.settings || {};
    const resolvedPreset =
      targetPreset || RESOLUTION_PRESETS.find((r) => r.label === settings.resolution);

    const activeQuality = targetPreset ? String(targetPreset.bitrate) : settings.quality;
    const activeFps = targetPreset ? String(targetPreset.fps) : settings.fps;
    const activeCodec = targetPreset ? targetPreset.codec : settings.videoCodec;

    // Determine export dimensions, respecting project aspect ratio
    const projectWidth = projectSettings.width || studioOpts.width || 1920;
    const projectHeight = projectSettings.height || studioOpts.height || 1080;
    const isProjectPortrait = projectHeight > projectWidth;

    let exportWidth: number;
    let exportHeight: number;

    if (resolvedPreset?.value?.includes("x")) {
      const [presetW, presetH] = resolvedPreset.value.split("x").map(Number);
      const isPresetPortrait = presetH > presetW;
      // Swap dimensions if preset orientation doesn't match project orientation
      if (isProjectPortrait !== isPresetPortrait) {
        exportWidth = presetH;
        exportHeight = presetW;
      } else {
        exportWidth = presetW;
        exportHeight = presetH;
      }
    } else {
      exportWidth = projectWidth;
      exportHeight = projectHeight;
    }

    const compositorOptions: any = {
      width: settings.includeVideo ? exportWidth : 0,
      height: settings.includeVideo ? exportHeight : 0,
      fps: Number(activeFps),
      backgroundColor: projectSettings.backgroundColor || "#000000",
      format: activeFormat,
      videoCodec: settings.includeVideo ? activeCodec : undefined,
      bitrate: Number(activeQuality),
      audio: settings.includeAudio ? true : false,
      audioCodec: settings.includeAudio ? settings.audioCodec : undefined,
      audioSampleRate: settings.includeAudio ? Number(settings.audioSampleRate) : undefined,
      prioritizeSpeed: true,
    };

    compositor = new Compositor(compositorOptions);
    if (settings.includeVideo) await compositor.initPixiApp();
    onCompositor?.(compositor);

    if (onProgress) {
      compositor.on("export:progress", onProgress);
    }

    await compositor.loadFromJSON(json);

    // Load all custom fonts used in clips to ensure identical styling on export
    const fontsToLoad: { name: string; url: string }[] = [
      {
        name: editorFont.fontFamily,
        url: editorFont.fontUrl,
      },
    ];

    if (json.clips) {
      Object.values(json.clips).forEach((clip: any) => {
        if (clip.style?.fontFamily && clip.style?.fontUrl) {
          fontsToLoad.push({
            name: clip.style.fontFamily,
            url: clip.style.fontUrl,
          });
        }
      });
    }

    const uniqueFonts = Array.from(new Map(fontsToLoad.map((f) => [f.name, f])).values());
    await fontManager.loadFonts(uniqueFonts).catch((err) => {
      console.warn("Failed to load fonts for export:", err);
    });

    const stream = compositor.output({ maxTime: json.settings?.duration || 0 });
    const blob = await new Response(stream).blob();
    const blobUrl = URL.createObjectURL(blob);

    return { blob, blobUrl, format: activeFormat };
  } finally {
    restoreRAF();
    studio.resumeRendering();
    if (wasPlaying) studio.play().catch(() => undefined);
    if (compositor) {
      try {
        compositor.destroy();
      } catch {
        // Already destroyed (e.g. cancelled via onCompositor) — ignore.
      }
    }
  }
}
