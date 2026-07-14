"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useStudioStore } from "@/stores/studio-store";
import { usePanelStore } from "@/stores/panel-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { PropertiesPanelContent } from "./right-panel/properties/properties-panel";
import {
  getPropertiesForType,
  PROPERTY_LABELS,
  type PropertyKey,
} from "./right-panel/properties/property-registry";

/**
 * CapCut-style properties drawer for the compact layout: a horizontal,
 * scrollable row of category chips with one property section shown at a
 * time, instead of the desktop panel's long vertical form.
 */
export function MobilePropertiesDrawer() {
  const { selectedClips } = useStudioStore();
  const setPropertiesSheetOpen = usePanelStore((s) => s.setPropertiesSheetOpen);

  const clip = selectedClips.length === 0 ? ({ type: "Scene" } as any) : selectedClips[0];
  const propertyKeys = useMemo(() => getPropertiesForType(clip.type), [clip.type]);

  const [activeKey, setActiveKey] = useState<PropertyKey | null>(propertyKeys[0] ?? null);

  // Reset the active chip when the clip type changes (or keys no longer match).
  useEffect(() => {
    setActiveKey((prev) => (prev && propertyKeys.includes(prev) ? prev : (propertyKeys[0] ?? null)));
  }, [propertyKeys]);

  // CapCut closes the clip panel when the selection is cleared. Only when the
  // drawer was showing a clip — the canvas (Scene) drawer stays.
  const hadSelection = useRef(selectedClips.length > 0);
  useEffect(() => {
    if (hadSelection.current && selectedClips.length === 0) {
      setPropertiesSheetOpen(false);
    }
    hadSelection.current = selectedClips.length > 0;
  }, [selectedClips.length, setPropertiesSheetOpen]);

  if (selectedClips.length > 1) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Group selection
      </div>
    );
  }

  const title = clip.type === "Scene" ? "Canvas" : (clip.name || clip.type);

  return (
    <div className="h-full flex flex-col">
      {/* Category chips */}
      <div className="shrink-0 pt-3 pb-1">
        <div className="px-4 pb-2 text-[11px] font-medium text-muted-foreground truncate pr-12">
          {title}
        </div>
        <div className="flex gap-1.5 px-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {propertyKeys.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveKey(key)}
              className={cn(
                "shrink-0 h-8 px-3.5 rounded-full text-xs whitespace-nowrap transition-colors",
                activeKey === key
                  ? "bg-foreground text-background font-medium"
                  : "bg-secondary text-muted-foreground",
              )}
            >
              {PROPERTY_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      {/* Active section */}
      <ScrollArea className="flex-1 min-h-0 px-4">
        <div
          className={cn(
            "flex flex-col gap-2 pb-[max(env(safe-area-inset-bottom),12px)] transition-opacity",
            clip.locked && "opacity-50 pointer-events-none select-none",
          )}
        >
          {activeKey ? (
            <PropertiesPanelContent clip={clip} only={[activeKey]} />
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No editable properties
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
