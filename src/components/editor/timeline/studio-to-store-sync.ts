import { clipToJSON, type IClip as StudioClip, Studio, jsonToClip } from "@openvideo/engine-pixi";
import CanvasTimeline, { TIMELINE_SEEK } from "@openvideo/timeline";
import { IClip } from "@/types/timeline";
import { core, projectStore } from "@/lib/project";
import { loadFromOpfs } from "@/lib/opfs-storage";
import { useStudioStore } from "@/stores/studio-store";
import { nanoid } from "nanoid";

/**
 * Connects the Timeline instance to the Zustand store for Store -> Engine sync.
 */
// Note: addTimelineStoreSync has been consolidated into addStudioSync
// to follow a pure Core-First synchronization flow.

/**
 * Connects the Studio instance to the Store and Timeline.
 */
export const addStudioSync = (studio: Studio, timeline: CanvasTimeline): (() => void) => {
  console.log("Adding studio sync with Core-First flow");
  // --- 1. ENGINES -> CORE (Interaction Capture) ---

  // Captures changes from Studio (e.g. property panel or direct canvas edits)
  // After a transform ends, the SelectionManager already calls core.execute internally
  // (when core is attached). Here we only listen to emit real-time transforming events.
  const handleClipTransforming = ({ clip }: { clip: IClip }) => {
    const serialized = clipToJSON(clip as unknown as StudioClip) as any;
    // Real-time signaling only — no state commit yet
    core.emit("clip:transforming", { id: clip.id, updates: serialized });
  };

  // When Core is attached (via StudioBridge) the Studio no longer needs to write
  // back to the store directly — the core command pipeline handles it. We only
  // sync selection which is still a lightweight store write.
  studio.on("clip:transforming", handleClipTransforming as any);

  // Captures timeline seek events
  const handleTimelineSeek = ({ payload }: any) => {
    const time = payload?.time;
    // Never propagate a non-finite seek into Core — it corrupts currentTime
    // and surfaces as a "NaN:NaN" timecode / NaN playhead position.
    if (!Number.isFinite(time)) return;
    projectStore.getState().seek(Math.max(0, time));
  };

  timeline.emitter.on(TIMELINE_SEEK, handleTimelineSeek);

  // Timeline drop events → route through core.clip.add
  const handleAddClip = async ({ payload, options }: any) => {
    try {
      // Local-mode assets carry a persistent opfs:// reference; mint a fresh
      // memory-backed URL from it in case the dragged session URL went stale.
      if (payload?.persistSrc) {
        const fresh = await loadFromOpfs(payload.persistSrc);
        if (fresh) payload.src = fresh;
      }
      // Prefer the seek-friendly preview proxy; record the original so the
      // export pipeline swaps it back in for full-quality output.
      if (payload?.proxySrc) {
        const proxyUrl = await loadFromOpfs(payload.proxySrc);
        if (proxyUrl) {
          payload.metadata = {
            ...payload.metadata,
            originalSrc: payload.persistSrc ?? payload.src,
          };
          payload.src = proxyUrl;
        }
      }
      // Tag the clip with its source asset so a proxy that finishes generating
      // after the drop can locate and hot-swap it.
      if (payload?.assetId) {
        payload.metadata = { ...payload.metadata, assetId: payload.assetId };
      }
      // Durable source for audio (and non-proxy media): lets export re-resolve a
      // fresh URL even if the session blob: src is later revoked.
      if (payload?.persistSrc && !payload.metadata?.originalSrc) {
        payload.metadata = { ...payload.metadata, originalSrc: payload.persistSrc };
      }
      delete payload?.persistSrc;
      delete payload?.proxySrc;
      delete payload?.assetId;
      await core.clip.add(payload, options);
    } catch (e) {
      console.error("Failed to add clip from timeline drop:", e);
    }
  };

  timeline.emitter.on("add:video", handleAddClip);
  timeline.emitter.on("add:image", handleAddClip);
  timeline.emitter.on("add:audio", handleAddClip);
  timeline.emitter.on("add:text", handleAddClip);
  timeline.emitter.on("add:transition", handleAddClip);
  timeline.emitter.on("add:effect", handleAddClip);
  timeline.emitter.on("add:shape", handleAddClip);

  // --- 2. CORE -> ENGINES (Reconciliation via store subscription) ---
  // The StudioBridge + TimelineBridge handle patch-driven reconciliation.
  // This subscription handles scale sync and selection cross-sync only.
  let prevState = projectStore.getState();

  const unsubCore = projectStore.subscribe(async (state) => {
    const currentPrevState = prevState;
    prevState = state;

    try {
      // Scale
      if (state.scale !== currentPrevState.scale) {
        timeline.syncScale({ scale: state.scale });
      }

      // Selection cross-sync (Studio <-> Core)
      if (state.selectedIds !== currentPrevState.selectedIds) {
        // Sync StudioStore (Global UI State)
        const { setSelectedClips } = useStudioStore.getState();
        const engineClips = state.selectedIds
          .map((id) => studio.timeline.getClipById(id))
          .filter(Boolean);
        setSelectedClips(engineClips as any[]);
      }
    } catch (e) {
      console.warn("Core subscription error:", e);
    }
  });

  return () => {
    studio.off("clip:transforming", handleClipTransforming as any);
    timeline.emitter.off(TIMELINE_SEEK, handleTimelineSeek);
    timeline.emitter.off("add:video", handleAddClip);
    timeline.emitter.off("add:image", handleAddClip);
    timeline.emitter.off("add:audio", handleAddClip);
    timeline.emitter.off("add:text", handleAddClip);
    timeline.emitter.off("add:transition", handleAddClip);
    timeline.emitter.off("add:effect", handleAddClip);
    timeline.emitter.off("add:shape", handleAddClip);
    unsubCore();
  };
};
