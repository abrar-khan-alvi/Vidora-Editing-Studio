"use client";

import { useAssetsStore } from "@/stores/assets-store";
import { RiLoader5Line } from "@remixicon/react";

/**
 * Header pill that surfaces background preview-proxy generation (CapCut-style
 * "optimizing for preview"). Non-blocking and self-hiding: renders nothing when
 * no proxy work is in flight. Clips remain fully editable against the original
 * while this runs, and hot-swap to the proxy the moment it finishes.
 */
export function ProxyStatusIndicator() {
  const files = useAssetsStore((s) => s.files);
  const optimizing = files.filter((f) => f.indexingStage === "optimizing_for_preview");

  if (optimizing.length === 0) return null;

  const avg = Math.round(
    optimizing.reduce((sum, f) => sum + (f.indexingProgress ?? 0), 0) / optimizing.length,
  );

  return (
    <div className="hidden sm:flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-muted/60 border border-border text-[11px] text-muted-foreground">
      <RiLoader5Line className="size-3.5 animate-spin text-primary" />
      <span className="whitespace-nowrap">
        Optimizing {optimizing.length} clip{optimizing.length === 1 ? "" : "s"} for preview
        {avg > 0 ? ` · ${avg}%` : "…"}
      </span>
    </div>
  );
}
