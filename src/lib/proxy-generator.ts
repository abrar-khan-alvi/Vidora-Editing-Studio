/**
 * Preview-proxy generation (CapCut-style).
 *
 * Source videos (especially phone recordings / web rips) often have keyframes
 * several seconds apart, which makes every seek re-decode from the last
 * keyframe — play-start takes 1–3s. On upload we re-encode the video once
 * into a seek-friendly proxy (dense keyframes, capped resolution) that the
 * editor uses for preview. The original file is swapped back in at export
 * time, so output quality is untouched.
 *
 * The actual transcode runs in a Web Worker (see proxy-worker.ts) so the
 * editor UI never janks, and requests are serialized (concurrency 1) so
 * multiple uploads don't thrash WebCodecs. If the worker can't be created in
 * the current environment, we transparently fall back to the main thread.
 */

import { transcodeToProxy, type ProxyProgress } from "./proxy-transcode";
import type { ProxyWorkerRequest, ProxyWorkerResponse } from "./proxy-worker";

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;

interface PendingJob {
  resolve: (blob: Blob | null) => void;
  reject: (err: unknown) => void;
  onProgress?: ProxyProgress;
}
const pending = new Map<number, PendingJob>();

function getWorker(): Worker | null {
  if (workerBroken || typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./proxy-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<ProxyWorkerResponse>) => {
      const msg = e.data;
      const job = pending.get(msg.id);
      if (!job) return;
      if (msg.type === "progress") {
        job.onProgress?.(msg.progress);
        return;
      }
      pending.delete(msg.id);
      if (msg.type === "error") {
        job.reject(new Error(msg.message));
        return;
      }
      job.resolve(msg.buffer ? new Blob([msg.buffer], { type: "video/mp4" }) : null);
    };
    worker.onerror = () => {
      // Worker failed to load/run — mark broken and reject in-flight jobs so
      // they fall back to the main thread.
      workerBroken = true;
      for (const [, job] of pending) job.reject(new Error("proxy worker error"));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

function runOnce(file: File | Blob, onProgress?: ProxyProgress): Promise<Blob | null> {
  const w = getWorker();
  if (!w) return transcodeToProxy(file, onProgress);

  return new Promise<Blob | null>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, onProgress });
    w.postMessage({ id, file } satisfies ProxyWorkerRequest);
  }).catch(() => {
    // Worker errored for this job — retry on the main thread so the user
    // still gets a proxy.
    return transcodeToProxy(file, onProgress);
  });
}

// Serialize proxy generation so concurrent uploads don't compete for WebCodecs.
let queue: Promise<unknown> = Promise.resolve();

export function generateVideoProxy(
  file: File | Blob,
  onProgress?: ProxyProgress,
): Promise<Blob | null> {
  const run = queue.then(() => runOnce(file, onProgress));
  // Keep the chain alive regardless of individual job outcomes.
  queue = run.catch(() => undefined);
  return run;
}
