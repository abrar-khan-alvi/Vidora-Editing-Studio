"use client";

import { useStore } from "zustand";
import { core, projectStore } from "@/lib/project";
import { usePanelStore } from "@/stores/panel-store";
import { useMediaPanelStore, type Tab } from "@/components/editor/media-panel/store";
import { cn } from "@/lib/utils";
import {
  RiImage2Line,
  RiTBoxLine,
  RiClosedCaptioningLine,
  RiAspectRatioLine,
  RiCloseLine,
  RiSplitCellsHorizontal,
  RiDeleteBinLine,
  RiFileCopyLine,
  RiVolumeMuteLine,
  RiVolumeUpLine,
  RiLockLine,
  RiLockUnlockLine,
  RiEqualizerLine,
} from "@remixicon/react";

interface RibbonItem {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}

/**
 * CapCut-style bottom tool ribbon for the compact layout. Shows the root
 * tools (Media / Text / Captions / Canvas) by default and swaps to
 * clip-context tools (Split / Delete / Duplicate / …) while a clip is
 * selected, with a leading ✕ to deselect.
 */
export function MobileToolRibbon() {
  const selectedIds = useStore(projectStore, (s) => s.selectedIds);
  const selectedClip = useStore(projectStore, (s) =>
    s.selectedIds[0] ? s.clips[s.selectedIds[0]] : undefined,
  ) as any;

  const { mediaSheetOpen, propertiesSheetOpen, setMediaSheetOpen, setPropertiesSheetOpen } =
    usePanelStore();
  const setActiveTab = useMediaPanelStore((s) => s.setActiveTab);

  const hasSelection = selectedIds.length > 0 && !!selectedClip;
  const isLocked = selectedClip?.locked ?? false;
  const isMuted = selectedClip?.muted ?? false;
  const hasAudio = selectedClip?.type === "Video" || selectedClip?.type === "Audio";

  const openMediaTab = (tab: Tab) => {
    setActiveTab(tab); // also un-collapses the panel content
    setMediaSheetOpen(true);
  };

  const handleDeselect = () => projectStore.getState().select([]);

  const handleSplit = () => {
    const time = projectStore.getState().currentTime;
    if (!Number.isFinite(time)) return;
    core.clip.split(time);
  };

  const rootItems: RibbonItem[] = [
    {
      key: "media",
      label: "Media",
      icon: RiImage2Line,
      active: mediaSheetOpen,
      onClick: () => openMediaTab("assets"),
    },
    {
      key: "text",
      label: "Text",
      icon: RiTBoxLine,
      onClick: () => openMediaTab("text"),
    },
    {
      key: "captions",
      label: "Captions",
      icon: RiClosedCaptioningLine,
      onClick: () => openMediaTab("captions"),
    },
    {
      key: "canvas",
      label: "Canvas",
      icon: RiAspectRatioLine,
      active: propertiesSheetOpen,
      onClick: () => setPropertiesSheetOpen(!propertiesSheetOpen),
    },
  ];

  const contextItems: RibbonItem[] = [
    {
      key: "split",
      label: "Split",
      icon: RiSplitCellsHorizontal,
      disabled: isLocked,
      onClick: handleSplit,
    },
    {
      key: "delete",
      label: "Delete",
      icon: RiDeleteBinLine,
      disabled: isLocked,
      onClick: () => core.clip.remove(selectedIds),
    },
    {
      key: "duplicate",
      label: "Copy",
      icon: RiFileCopyLine,
      disabled: isLocked,
      onClick: () => core.clip.duplicate(selectedIds),
    },
    ...(hasAudio
      ? [
          {
            key: "mute",
            label: isMuted ? "Unmute" : "Mute",
            icon: isMuted ? RiVolumeMuteLine : RiVolumeUpLine,
            disabled: isLocked,
            onClick: () => core.clip.update(selectedClip.id, { muted: !isMuted }),
          } satisfies RibbonItem,
        ]
      : []),
    {
      key: "lock",
      label: isLocked ? "Unlock" : "Lock",
      icon: isLocked ? RiLockLine : RiLockUnlockLine,
      onClick: () => core.clip.update(selectedClip?.id, { locked: !isLocked }),
    },
    {
      key: "edit",
      label: "Edit",
      icon: RiEqualizerLine,
      active: propertiesSheetOpen,
      onClick: () => setPropertiesSheetOpen(!propertiesSheetOpen),
    },
  ];

  const items = hasSelection ? contextItems : rootItems;

  return (
    <div className="shrink-0 border-t bg-background pb-[env(safe-area-inset-bottom)]">
      <div className="h-16 flex items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {hasSelection && (
          <>
            <button
              type="button"
              aria-label="Deselect"
              onClick={handleDeselect}
              className="w-12 shrink-0 flex items-center justify-center text-muted-foreground active:text-foreground"
            >
              <RiCloseLine className="size-5" />
            </button>
            <div className="w-px my-3 bg-border shrink-0" />
          </>
        )}
        {items.map(({ key, label, icon: Icon, onClick, disabled, active }) => (
          <button
            key={key}
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={cn(
              "flex-1 min-w-[64px] flex flex-col items-center justify-center gap-1 text-[10px] transition-colors",
              active ? "text-foreground" : "text-muted-foreground",
              disabled && "opacity-40",
            )}
          >
            <Icon className="size-5" />
            <span className="whitespace-nowrap">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
