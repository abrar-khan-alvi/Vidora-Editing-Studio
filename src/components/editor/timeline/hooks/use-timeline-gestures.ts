"use client";

import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { timeUsToUnits, unitsToTimeUs } from "@openvideo/timeline";
import type { ITimelineScaleState } from "@openvideo/timeline";
import { core, projectStore } from "@/lib/project";

/** Horizontal spacing the timeline reserves left of time 0 (spacing.left). */
const CONTENT_LEFT = 16;
/** Movement (px) before a touch resolves from tap into a pan. */
const PAN_THRESHOLD = 6;
/** Momentum decay per frame (~60fps). */
const MOMENTUM_FRICTION = 0.94;
/** Velocity (px/ms) below which momentum stops / doesn't start. */
const MOMENTUM_MIN = 0.05;
const MOMENTUM_START = 0.15;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;

interface TimelineGestureOptions {
  /** Only active in the compact (mobile/tablet) layout. */
  enabled: boolean;
  timeline: any | null; // CanvasTimeline instance
  containerRef: React.RefObject<HTMLDivElement | null>;
  timelineOffsetX: number;
  scale: ITimelineScaleState;
  setScale: (scale: ITimelineScaleState) => void;
  scrollLeft: number;
  /** Scrolls the fabric canvas + ruler and updates React scroll state. */
  onScroll: (scrollLeft: number) => void;
}

interface GestureState {
  mode: "pending" | "pan-h" | "pan-v" | "pinch";
  startX: number;
  startY: number;
  startScrollLeft: number;
  startScrollTop: number;
  maxScrollTop: number;
  startDist: number;
  startZoom: number;
  /** Recent x/time samples for release velocity. */
  samples: { x: number; t: number }[];
}

/**
 * CapCut-style touch gestures for the timeline (compact layout):
 *
 * - The playhead is fixed at the horizontal center; the content scrolls under
 *   it. Scrolling IS seeking — one-finger horizontal pan on empty timeline
 *   area scrubs, with momentum on release.
 * - One-finger vertical pan scrolls the track list.
 * - Two-finger pinch zooms the timeline, anchored at the playhead.
 * - A tap on empty area clears the selection; touches that start on a clip
 *   are left to the fabric canvas (select / drag / trim).
 */
export function useTimelineGestures({
  enabled,
  timeline,
  containerRef,
  timelineOffsetX,
  scale,
  setScale,
  scrollLeft,
  onScroll,
}: TimelineGestureOptions) {
  const currentTimeUsRaw = useStore(projectStore, (s) => s.currentTime);
  const isPlaying = useStore(projectStore, (s) => s.isPlaying);
  const currentTimeUs = Number.isFinite(currentTimeUsRaw) ? currentTimeUsRaw : 0;

  // Latest-value refs so the gesture listeners can be attached once.
  const latest = useRef({ scale, scrollLeft, onScroll, setScale, timelineOffsetX });
  latest.current = { scale, scrollLeft, onScroll, setScale, timelineOffsetX };

  const gestureRef = useRef<GestureState | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const scrollTopRef = useRef(0);
  const momentumRaf = useRef<number | null>(null);
  /** Set while a gesture (or its momentum) drives the scroll, so the
   *  time→scroll follow effect doesn't fight it. */
  const gestureActiveRef = useRef(false);

  /** Distance from content origin to the fixed playhead center. */
  const centerOffset = () => {
    const el = containerRef.current;
    if (!el) return 0;
    const canvasWidth = el.clientWidth - latest.current.timelineOffsetX;
    return canvasWidth / 2 - CONTENT_LEFT;
  };

  const scrollBounds = (zoom: number) => {
    const duration = projectStore.getState().settings.duration;
    const c = centerOffset();
    return {
      min: -c,
      max: timeUsToUnits(Number.isFinite(duration) ? duration : 0, zoom) - c,
    };
  };

  const seekToScroll = (newScrollLeft: number) => {
    const { onScroll: scroll, scale: sc } = latest.current;
    scroll(newScrollLeft);
    const timeUs = unitsToTimeUs(newScrollLeft + centerOffset(), sc.zoom);
    if (Number.isFinite(timeUs)) projectStore.getState().seek(Math.max(0, timeUs));
  };

  const stopMomentum = () => {
    if (momentumRaf.current !== null) {
      cancelAnimationFrame(momentumRaf.current);
      momentumRaf.current = null;
    }
    gestureActiveRef.current = false;
  };

  // --- Center-follow: keep scroll bound to currentTime (playback, external
  // seeks, zoom changes). Skipped while a gesture drives the scroll itself.
  useEffect(() => {
    if (!enabled || !timeline) return;
    if (gestureActiveRef.current) return;
    const target = timeUsToUnits(currentTimeUs, scale.zoom) - centerOffset();
    if (Math.abs(target - scrollLeft) > 0.5) {
      latest.current.onScroll(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, timeline, currentTimeUs, scale.zoom, scrollLeft, timelineOffsetX]);

  // --- Gesture listeners
  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || !timeline || !container) return;

    const isTouchLike = (e: PointerEvent) => e.pointerType === "touch" || e.pointerType === "pen";

    const isOnClip = (e: PointerEvent) => {
      try {
        const pointer = timeline.getScenePoint(e);
        const items = timeline.itemsManager.getTrackItems();
        return items.some((item: any) => {
          const b = item.getBoundingRect();
          return (
            pointer.x >= b.left &&
            pointer.x <= b.left + b.width &&
            pointer.y >= b.top &&
            pointer.y <= b.top + b.height
          );
        });
      } catch {
        return false;
      }
    };

    const maxScrollTop = () => {
      try {
        const items = timeline.itemsManager.getTrackItems();
        const bottom = items.reduce((acc: number, item: any) => {
          const b = item.getBoundingRect();
          return Math.max(acc, b.top + b.height);
        }, 0);
        return Math.max(0, bottom + 24 - timeline.height);
      } catch {
        return 0;
      }
    };

    const pinchDist = () => {
      const pts = [...pointersRef.current.values()];
      if (pts.length < 2) return 0;
      return Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!isTouchLike(e)) return;
      const target = e.target as HTMLElement | null;
      // Only touches on the fabric canvas area (not the ruler) participate.
      if (!target?.closest?.(".canvas-container")) return;

      stopMomentum();
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointersRef.current.size === 2 && gestureRef.current) {
        // Second finger while panning → pinch zoom.
        e.stopPropagation();
        e.preventDefault();
        gestureRef.current.mode = "pinch";
        gestureRef.current.startDist = pinchDist();
        gestureRef.current.startZoom = latest.current.scale.zoom;
        gestureActiveRef.current = true;
        return;
      }

      if (pointersRef.current.size !== 1) return;
      // A touch that starts on a clip belongs to fabric (select/drag/trim).
      if (isOnClip(e)) return;

      // Empty area: candidate pan. Block fabric's drag-selection box.
      e.stopPropagation();
      gestureRef.current = {
        mode: "pending",
        startX: e.clientX,
        startY: e.clientY,
        startScrollLeft: latest.current.scrollLeft,
        startScrollTop: scrollTopRef.current,
        maxScrollTop: maxScrollTop(),
        startDist: 0,
        startZoom: latest.current.scale.zoom,
        samples: [{ x: e.clientX, t: performance.now() }],
      };
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isTouchLike(e)) return;
      if (!pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      const g = gestureRef.current;
      if (!g) return;

      if (g.mode === "pinch") {
        e.preventDefault();
        const dist = pinchDist();
        if (g.startDist > 0 && dist > 0) {
          const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (g.startZoom * dist) / g.startDist));
          const { scale: sc, setScale: apply } = latest.current;
          if (Math.abs(zoom - sc.zoom) > 0.001) {
            apply({ ...sc, zoom });
            // Re-anchor immediately so the playhead time stays centered.
            const t = projectStore.getState().currentTime;
            const target = timeUsToUnits(Number.isFinite(t) ? t : 0, zoom) - centerOffset();
            latest.current.onScroll(target);
          }
        }
        return;
      }

      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;

      if (g.mode === "pending") {
        if (Math.abs(dx) < PAN_THRESHOLD && Math.abs(dy) < PAN_THRESHOLD) return;
        g.mode = Math.abs(dx) >= Math.abs(dy) ? "pan-h" : "pan-v";
        gestureActiveRef.current = true;
        if (g.mode === "pan-h" && projectStore.getState().isPlaying) core.pause();
      }

      e.preventDefault();

      if (g.mode === "pan-h") {
        const { min, max } = scrollBounds(latest.current.scale.zoom);
        const next = Math.max(min, Math.min(max, g.startScrollLeft - dx));
        seekToScroll(next);
        const now = performance.now();
        g.samples.push({ x: e.clientX, t: now });
        while (g.samples.length > 6 || (g.samples.length > 1 && now - g.samples[0].t > 100)) {
          g.samples.shift();
        }
      } else if (g.mode === "pan-v") {
        const next = Math.max(0, Math.min(g.maxScrollTop, g.startScrollTop - dy));
        scrollTopRef.current = next;
        timeline.scrollTo({ scrollTop: next });
      }
    };

    const startMomentum = (velocity: number) => {
      let v = velocity; // px per ms
      let last = performance.now();
      gestureActiveRef.current = true;
      const step = () => {
        const now = performance.now();
        const dt = now - last;
        last = now;
        const { min, max } = scrollBounds(latest.current.scale.zoom);
        const next = latest.current.scrollLeft - v * dt;
        if (next <= min || next >= max || Math.abs(v) < MOMENTUM_MIN) {
          seekToScroll(Math.max(min, Math.min(max, next)));
          stopMomentum();
          return;
        }
        seekToScroll(next);
        v *= MOMENTUM_FRICTION;
        momentumRaf.current = requestAnimationFrame(step);
      };
      momentumRaf.current = requestAnimationFrame(step);
    };

    const onPointerEnd = (e: PointerEvent) => {
      if (!pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.delete(e.pointerId);

      const g = gestureRef.current;
      if (!g) return;

      if (g.mode === "pinch") {
        // Pinch ends when either finger lifts; require a fresh touch after.
        if (pointersRef.current.size < 2) {
          gestureRef.current = null;
          pointersRef.current.clear();
          gestureActiveRef.current = false;
        }
        return;
      }

      if (pointersRef.current.size > 0) return;

      if (g.mode === "pending") {
        // Tap on empty area → deselect, CapCut-style.
        projectStore.getState().select([]);
      } else if (g.mode === "pan-h" && g.samples.length >= 2) {
        const first = g.samples[0];
        const lastSample = g.samples[g.samples.length - 1];
        const dt = lastSample.t - first.t;
        const v = dt > 0 ? (lastSample.x - first.x) / dt : 0;
        if (Math.abs(v) > MOMENTUM_START && e.type !== "pointercancel") {
          gestureRef.current = null;
          startMomentum(v);
          return;
        }
      }
      gestureRef.current = null;
      gestureActiveRef.current = false;
    };

    container.addEventListener("pointerdown", onPointerDown, { capture: true });
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);

    return () => {
      container.removeEventListener("pointerdown", onPointerDown, { capture: true });
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      stopMomentum();
      gestureRef.current = null;
      pointersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, timeline]);

  // Pause playback-driven panning fights: nothing to do — while playing, the
  // follow effect scrolls; touching the timeline pauses before panning.
  void isPlaying;
}
