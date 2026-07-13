import { core, projectStore } from "@/lib/project";

/**
 * Playback helpers that add CapCut-style "replay from start" behaviour.
 *
 * When the playhead is parked at the very end of the project and the user
 * presses play, the transport otherwise appears stuck (there's nothing left to
 * play). These helpers rewind to the start first so playback actually begins.
 */

function rewindIfAtEnd(): void {
  const state = projectStore.getState();
  const duration = state.settings?.duration ?? 0;
  const fps = state.settings?.fps || 30;
  if (!Number.isFinite(duration) || duration <= 0) return;

  const frameUs = 1_000_000 / fps;
  // "Within one frame of the end" counts as at-end (playback auto-pauses there).
  if (state.currentTime >= duration - frameUs) {
    core.seek(0);
  }
}

/** Starts playback, rewinding to the start first if parked at the end. */
export function playFromStartAware(): void {
  rewindIfAtEnd();
  // core.play() may return the media element's play() promise, which rejects
  // with AbortError if interrupted — swallow it.
  Promise.resolve(core.play()).catch(() => undefined);
}

/** Toggles playback with the same replay-from-end behaviour. */
export function togglePlayback(): void {
  if (projectStore.getState().isPlaying) {
    core.pause();
    return;
  }
  playFromStartAware();
}
