"use client";

import { useStore } from "zustand";
import { core, projectStore } from "@/lib/project";
import { playFromStartAware } from "@/lib/playback";
import { timeToString } from "./utils/time";
import { cn } from "@/lib/utils";
import {
  RiPlayFill,
  RiPauseFill,
  RiArrowGoBackLine,
  RiArrowGoForwardLine,
  RiAddLine,
  RiSubtractLine,
} from "@remixicon/react";

/**
 * Slim playback strip between the preview and the timeline in the compact
 * (CapCut-style) layout. Replaces the timeline's own header, which is hidden
 * in compact mode.
 */
export function MobilePlaybackBar() {
  const isPlaying = useStore(projectStore, (s) => s.isPlaying);
  const currentTimeRaw = useStore(projectStore, (s) => s.currentTime);
  const durationRaw = useStore(projectStore, (s) => s.settings.duration);
  const scale = useStore(projectStore, (s) => s.scale);
  const setScale = projectStore.getState().setScale;

  // A non-finite time from an upstream seek must never reach the DOM.
  const currentTime = Number.isFinite(currentTimeRaw) ? currentTimeRaw : 0;
  const duration = Number.isFinite(durationRaw) ? durationRaw : 0;

  const changeZoom = (delta: number) => {
    const newZoom = Math.max(0.1, Math.min(10, scale.zoom + delta));
    setScale({ ...scale, zoom: newZoom });
  };

  return (
    <div className="shrink-0 h-11 border-t bg-background flex items-center px-3 select-none">
      {/* Time */}
      <div className="w-28 shrink-0 text-[11px] tabular-nums">
        <span className="font-medium text-foreground">{timeToString({ time: currentTime })}</span>
        <span className="text-muted-foreground"> / {timeToString({ time: duration })}</span>
      </div>

      {/* Transport */}
      <div className="flex-1 flex items-center justify-center gap-4">
        <BarButton label="Undo" onClick={() => core.undo()}>
          <RiArrowGoBackLine size={17} />
        </BarButton>
        <BarButton
          label={isPlaying ? "Pause" : "Play"}
          onClick={() => (isPlaying ? core.pause() : playFromStartAware())}
          className="size-8 text-foreground"
        >
          {isPlaying ? <RiPauseFill size={24} /> : <RiPlayFill size={24} />}
        </BarButton>
        <BarButton label="Redo" onClick={() => core.redo()}>
          <RiArrowGoForwardLine size={17} />
        </BarButton>
      </div>

      {/* Timeline zoom */}
      <div className="w-28 shrink-0 flex items-center justify-end gap-1">
        <BarButton label="Zoom out" onClick={() => changeZoom(-0.15)}>
          <RiSubtractLine size={17} />
        </BarButton>
        <BarButton label="Zoom in" onClick={() => changeZoom(0.15)}>
          <RiAddLine size={17} />
        </BarButton>
      </div>
    </div>
  );
}

function BarButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "size-7 flex items-center justify-center rounded-md text-muted-foreground active:scale-95 active:text-foreground transition-transform",
        className,
      )}
    >
      {children}
    </button>
  );
}
