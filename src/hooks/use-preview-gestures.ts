"use client";

import { useEffect } from "react";
import { core, projectStore } from "@/lib/project";
import { useStudioStore } from "@/stores/studio-store";

const MIN_CLIP_SIZE = 24;
const MAX_CLIP_SIZE = 8192;

interface StartState {
  clipId: string;
  clip: any;
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
  dist: number;
  touchAngle: number;
  mid: { x: number; y: number } | null;
}

/**
 * CapCut-style two-finger gesture on the preview canvas: pinch to scale,
 * twist to rotate and move the selected clip with both fingers. The engine
 * clip is mutated live (no history churn); a single core.clip.update commits
 * the result when the gesture ends. Single-finger interactions (tap-select,
 * drag-move, transformer handles) stay with the engine's SelectionManager.
 */
export function usePreviewGestures(containerRef: React.RefObject<HTMLDivElement | null>) {
  const { studio } = useStudioStore();

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !studio) return;

    const pointers = new Map<number, { x: number; y: number }>();
    let gesture: StartState | null = null;
    let raf: number | null = null;
    /** Selection as of the first touch — the engine may clear the selection
     *  while handling that same touch (drag-select on empty artboard), and the
     *  pinch should still target the clip the user had selected. */
    let preSelectedId: string | null = null;

    const getSelectedEngineClip = () => {
      let id = projectStore.getState().selectedIds[0];
      if (!id && preSelectedId) {
        id = preSelectedId;
        projectStore.getState().select([id]);
      }
      if (!id) return null;
      const coreClip = projectStore.getState().clips[id] as any;
      if (!coreClip || coreClip.locked) return null;
      const s = studio as any;
      const clip = s.getClipById?.(id) ?? s.timeline?.getClipById?.(id);
      return clip ? { id, clip } : null;
    };

    /** Converts a client point into artboard (project pixel) coordinates. */
    const toArtboard = (clientX: number, clientY: number) => {
      try {
        const s = studio as any;
        const app = s.pixiApp;
        const artboard = s.artboard;
        const canvas: HTMLCanvasElement | undefined = app?.canvas ?? app?.view;
        if (!app || !artboard || !canvas) return null;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const gx = ((clientX - rect.left) / rect.width) * app.renderer.screen.width;
        const gy = ((clientY - rect.top) / rect.height) * app.renderer.screen.height;
        const p = artboard.toLocal({ x: gx, y: gy });
        return { x: p.x, y: p.y };
      } catch {
        return null;
      }
    };

    const touchPoints = () => [...pointers.values()];

    const measure = () => {
      const [p1, p2] = touchPoints();
      return {
        dist: Math.hypot(p2.x - p1.x, p2.y - p1.y),
        angle: (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI,
        midClient: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
      };
    };

    const setTransformerVisible = (visible: boolean) => {
      try {
        const tr = (studio as any).selection?.activeTransformer;
        if (tr) tr.visible = visible;
      } catch {
        /* cosmetic only */
      }
    };

    const applyGesture = () => {
      raf = null;
      if (!gesture || pointers.size < 2) return;
      const { dist, angle, midClient } = measure();
      if (!gesture.dist || !dist) return;

      const rawRatio = dist / gesture.dist;
      const ratio = Math.max(
        MIN_CLIP_SIZE / Math.max(1, gesture.w),
        Math.min(MAX_CLIP_SIZE / Math.max(1, gesture.w), rawRatio),
      );

      let dmx = 0;
      let dmy = 0;
      if (gesture.mid) {
        const midNow = toArtboard(midClient.x, midClient.y);
        if (midNow) {
          dmx = midNow.x - gesture.mid.x;
          dmy = midNow.y - gesture.mid.y;
        }
      }

      const newW = gesture.w * ratio;
      const newH = gesture.h * ratio;
      const cx = gesture.x + gesture.w / 2 + dmx;
      const cy = gesture.y + gesture.h / 2 + dmy;

      const clip = gesture.clip;
      clip.left = cx - newW / 2;
      clip.top = cy - newH / 2;
      clip.width = newW;
      clip.height = newH;
      clip.angle = gesture.angle + (angle - gesture.touchAngle);
    };

    const scheduleApply = () => {
      if (raf === null) raf = requestAnimationFrame(applyGesture);
    };

    const endGesture = () => {
      if (!gesture) return;
      const { clipId, clip, x, y, w, h, angle } = gesture;
      gesture = null;
      if (raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
      // A two-finger tap (no actual movement) must not pollute undo history
      // with a no-op update.
      const changed =
        Math.abs((clip.left ?? 0) - x) > 0.01 ||
        Math.abs((clip.top ?? 0) - y) > 0.01 ||
        Math.abs((clip.width ?? 0) - w) > 0.01 ||
        Math.abs((clip.height ?? 0) - h) > 0.01 ||
        Math.abs((clip.angle ?? 0) - angle) > 0.01;

      if (changed) {
        // Single history entry for the whole gesture.
        const coreClip = projectStore.getState().clips[clipId] as any;
        const updates: any = {
          transform: {
            ...(coreClip?.transform ?? {}),
            x: clip.left,
            y: clip.top,
            width: clip.width,
            height: clip.height,
            angle: clip.angle,
          },
        };
        // Note: Text/Caption clips keep their font size — the pinch scales the
        // box (wrap width). Scaling fontSize here clips the glyphs against the
        // committed box because the engine recomputes text bounds internally.
        core.clip.update(clipId, updates);
        try {
          (studio as any).selection?.refreshClipHitArea?.(clip);
          (studio as any).selection?.recreateTransformer?.();
        } catch {
          /* transformer refresh is cosmetic */
        }
      }
      setTransformerVisible(true);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        preSelectedId = projectStore.getState().selectedIds[0] ?? null;
      }
      if (pointers.size !== 2 || gesture) return;

      const selected = getSelectedEngineClip();
      if (!selected) return;

      // The first finger may be mid-drag inside the engine — cancel that drag
      // so the two-finger gesture fully owns the transform.
      const firstId = [...pointers.keys()][0];
      if (firstId !== e.pointerId) {
        try {
          const canvas = (studio as any).pixiApp?.canvas;
          canvas?.dispatchEvent(
            new PointerEvent("pointercancel", {
              pointerId: firstId,
              pointerType: "touch",
              bubbles: true,
            }),
          );
        } catch {
          /* engine may not have an active drag */
        }
      }
      e.stopPropagation();
      e.preventDefault();

      const { dist, angle, midClient } = measure();
      const clip = selected.clip;
      gesture = {
        clipId: selected.id,
        clip,
        x: clip.left ?? 0,
        y: clip.top ?? 0,
        w: clip.width || 1,
        h: clip.height || 1,
        angle: clip.angle ?? 0,
        dist,
        touchAngle: angle,
        mid: toArtboard(midClient.x, midClient.y),
      };
      setTransformerVisible(false);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gesture && pointers.size >= 2) {
        e.preventDefault();
        e.stopPropagation();
        scheduleApply();
      }
    };

    const onPointerEnd = (e: PointerEvent) => {
      // Ignore the synthetic pointercancel we dispatch at the engine's canvas
      // to abort its drag — it must not end our own gesture.
      if (!e.isTrusted) return;
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (gesture && pointers.size < 2) endGesture();
    };

    container.addEventListener("pointerdown", onPointerDown, { capture: true });
    window.addEventListener("pointermove", onPointerMove, { passive: false, capture: true });
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);

    return () => {
      container.removeEventListener("pointerdown", onPointerDown, { capture: true });
      window.removeEventListener("pointermove", onPointerMove, { capture: true });
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      if (raf !== null) cancelAnimationFrame(raf);
      pointers.clear();
      gesture = null;
    };
  }, [containerRef, studio]);
}
