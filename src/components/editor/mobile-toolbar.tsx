"use client";

import { usePanelStore } from "@/stores/panel-store";
import { useMediaPanelStore } from "@/components/editor/media-panel/store";
import { cn } from "@/lib/utils";
import { RiImage2Line, RiEqualizerLine, RiFilmLine } from "@remixicon/react";

/**
 * Bottom action bar shown in the compact (mobile/tablet) layout.
 * Opens the media/properties panels as overlay sheets and toggles the timeline.
 */
export function MobileToolbar() {
  const {
    showTimeline,
    toggleTimeline,
    mediaSheetOpen,
    propertiesSheetOpen,
    setMediaSheetOpen,
    setPropertiesSheetOpen,
  } = usePanelStore();
  const setMediaPanelOpen = useMediaPanelStore((s) => s.setIsOpen);

  const items = [
    {
      label: "Media",
      icon: RiImage2Line,
      active: mediaSheetOpen,
      onClick: () => {
        // The panel content itself can be collapsed — make sure it shows.
        setMediaPanelOpen(true);
        setMediaSheetOpen(true);
      },
    },
    {
      label: "Timeline",
      icon: RiFilmLine,
      active: showTimeline,
      onClick: toggleTimeline,
    },
    {
      label: "Edit",
      icon: RiEqualizerLine,
      active: propertiesSheetOpen,
      onClick: () => setPropertiesSheetOpen(true),
    },
  ];

  return (
    <div className="shrink-0 border-t bg-background pb-[env(safe-area-inset-bottom)]">
      <div className="h-14 flex items-stretch justify-around">
        {items.map(({ label, icon: Icon, active, onClick }) => (
          <button
            key={label}
            type="button"
            onClick={onClick}
            className={cn(
              "flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] transition-colors",
              active ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <Icon className="size-5" />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
