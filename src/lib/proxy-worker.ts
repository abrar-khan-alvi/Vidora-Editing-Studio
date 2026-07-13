/**
 * Web Worker that generates preview proxies off the main thread, so the editor
 * UI never janks while a heavy upload is being transcoded.
 *
 * Loaded by proxy-generator.ts via `new Worker(new URL(...))`. If the worker
 * fails to construct in a given environment, proxy-generator falls back to
 * running transcodeToProxy on the main thread.
 */

import { transcodeToProxy } from "./proxy-transcode";

export interface ProxyWorkerRequest {
  id: number;
  file: File | Blob;
}

export type ProxyWorkerResponse =
  | { id: number; type: "progress"; progress: number }
  | { id: number; type: "done"; buffer: ArrayBuffer | null }
  | { id: number; type: "error"; message: string };

function post(msg: ProxyWorkerResponse, transfer?: Transferable[]) {
  // Cast: this module runs in a DedicatedWorkerGlobalScope, but the project's
  // TS lib is DOM, where postMessage has a different signature.
  (self as unknown as { postMessage: (m: unknown, t?: Transferable[]) => void }).postMessage(
    msg,
    transfer,
  );
}

addEventListener("message", async (e: MessageEvent<ProxyWorkerRequest>) => {
  const { id, file } = e.data;
  try {
    const blob = await transcodeToProxy(file, (progress) => {
      post({ id, type: "progress", progress });
    });
    if (!blob) {
      post({ id, type: "done", buffer: null });
      return;
    }
    const buffer = await blob.arrayBuffer();
    post({ id, type: "done", buffer }, [buffer]);
  } catch (err) {
    post({ id, type: "error", message: String((err as Error)?.message ?? err) });
  }
});
