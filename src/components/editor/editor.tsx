"use client";
import { useState, useEffect } from "react";
import { Resizable } from "@/components/editor/resizable-panel";
import { useParams } from "next/navigation";
import { MediaPanel } from "@/components/editor/media-panel";
import { CanvasPanel } from "@/components/editor/canvas-panel";
import Timeline from "@/components/editor/timeline";
import { usePanelStore } from "@/stores/panel-store";
import { Loading } from "@/components/editor/loading";
import FloatingControl from "@/components/editor/floating-controls/floating-control";
import { Compositor } from "@openvideo/engine-pixi";
import { WebCodecsUnsupportedModal } from "@/components/editor/webcodecs-unsupported-modal";
import { RightPanel } from "./right-panel";
import { core } from "@/lib/project";
import { IProject } from "@openvideo/core";
import { useProjectStore } from "@/stores/project-store";
import Header from "./header";
import { data } from "./data";
import { MobileToolbar } from "./mobile-toolbar";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useIsCompact, useIsMobile } from "@/hooks/use-mobile";

export default function Editor({
  initialDesign,
}: {
  isDataLoading?: boolean;
  initialDesign?: IProject;
}) {
  const resetProject = useProjectStore((state) => state.resetProject);
  const {
    editorMode,
    showLeftPanel,
    showRightPanel,
    showTimeline,
    mediaSheetOpen,
    propertiesSheetOpen,
    setMediaSheetOpen,
    setPropertiesSheetOpen,
  } = usePanelStore();
  const isCompact = useIsCompact();
  const isMobile = useIsMobile();

  const [isReady, setIsReady] = useState(false);
  const [isWebCodecsSupported, setIsWebCodecsSupported] = useState(true);

  // Leaving compact mode closes the overlay sheets — the panels render inline.
  useEffect(() => {
    if (!isCompact) {
      setMediaSheetOpen(false);
      setPropertiesSheetOpen(false);
    }
  }, [isCompact, setMediaSheetOpen, setPropertiesSheetOpen]);

  // Start with empty project on mount
  useEffect(() => {
    resetProject();
    core.project.new();
  }, [resetProject]);

  useEffect(() => {
    const checkSupport = async () => {
      const isSupported = await Compositor.isSupported();
      setIsWebCodecsSupported(isSupported);
    };
    checkSupport();
  }, []);

  // Clear loading screen for non-editor modes (CanvasPanel doesn't mount, onReady never fires)
  useEffect(() => {
    if (editorMode !== "editor") {
      setIsReady(true);
    }
  }, [editorMode]);

  return (
    <div className="h-screen w-screen flex flex-col bg-background overflow-hidden">
      {!isReady && (
        <div className="absolute inset-0 z-100">
          <Loading />
        </div>
      )}

      {/* Header — full width */}
      <Header />

      {/* Main content row: left sidebar + center + right sidebar.
          In compact (mobile/tablet) mode the side panels render as overlay
          sheets instead, and the timeline gets a fixed height. */}
      <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
        {/* Left Sidebar: Media Panel (desktop only) */}
        {!isCompact && showLeftPanel && (
          <Resizable orientation="horizontal" initialSize={300} min={180} max={520} direction="right">
            <MediaPanel />
          </Resizable>
        )}

        {/* Center: Canvas (top) + Timeline (bottom) */}
        <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 overflow-visible">
            <CanvasPanel onReady={() => setIsReady(true)} />
          </div>
          {showTimeline &&
            (isCompact ? (
              <div className={`shrink-0 w-full ${isMobile ? "h-[190px]" : "h-[230px]"}`}>
                <Timeline />
              </div>
            ) : (
              <Resizable orientation="vertical" initialSize={260} min={200} max={500} direction="up">
                <Timeline />
              </Resizable>
            ))}
        </div>

        {!isCompact && showRightPanel && (
          <Resizable
            orientation="horizontal"
            initialSize={280}
            min={180}
            max={520}
            direction="left"
            className="right-resizable-panel"
          >
            <RightPanel />
          </Resizable>
        )}
      </div>

      {/* Compact mode: bottom toolbar + panels as overlay sheets */}
      {isCompact && <MobileToolbar />}
      {isCompact && (
        <>
          <Sheet open={mediaSheetOpen} onOpenChange={setMediaSheetOpen}>
            <SheetContent
              side="left"
              aria-describedby={undefined}
              className="w-[85vw] max-w-[380px] p-0 gap-0"
            >
              <SheetTitle className="sr-only">Media</SheetTitle>
              <div className="flex-1 min-h-0 overflow-hidden">
                <MediaPanel />
              </div>
            </SheetContent>
          </Sheet>
          <Sheet open={propertiesSheetOpen} onOpenChange={setPropertiesSheetOpen}>
            <SheetContent
              side="right"
              aria-describedby={undefined}
              className="w-[85vw] max-w-[380px] p-0 gap-0"
            >
              <SheetTitle className="sr-only">Properties</SheetTitle>
              <div className="flex-1 min-h-0 overflow-hidden">
                <RightPanel />
              </div>
            </SheetContent>
          </Sheet>
        </>
      )}

      {/* Floating Controls like Caption / Animation pickers */}
      <FloatingControl />

      {/* WebCodecs Support Check Modal */}
      <WebCodecsUnsupportedModal open={!isWebCodecsSupported} />
    </div>
  );
}
