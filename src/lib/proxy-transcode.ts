/**
 * Pure (DOM-free) proxy transcode logic — safe to run on the main thread or
 * inside a Web Worker.
 *
 * Produces a seek-friendly MP4 proxy (capped resolution, dense keyframes), or
 * returns `null` when a proxy isn't worth generating — either because the
 * source is already light and densely keyframed (it's its own best proxy) or
 * because transcoding failed. In every `null` case the caller safely falls
 * back to editing against the original file.
 */

/** Long-edge cap for proxy resolution — preview only, keeps decode cheap. */
const PROXY_MAX_LONG_EDGE = 1280;
/** Keyframe every 0.5s makes any seek land at most ~15 frames away. */
const PROXY_KEYFRAME_INTERVAL_S = 0.5;

/** Skip proxy when the source is already within this long-edge… */
const ALREADY_LIGHT_LONG_EDGE = 1280;
/** …and its keyframes are already at least this dense (seconds). */
const ALREADY_DENSE_GOP_S = 1.0;

export type ProxyProgress = (progress: number) => void;

export async function transcodeToProxy(
  file: File | Blob,
  onProgress?: ProxyProgress,
): Promise<Blob | null> {
  try {
    const {
      ALL_FORMATS,
      Input,
      BlobSource,
      Output,
      BufferTarget,
      Mp4OutputFormat,
      Conversion,
      QUALITY_MEDIUM,
      EncodedPacketSink,
    } = await import("mediabunny");

    const input = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(file),
    });

    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) return null;

    const w = videoTrack.displayWidth;
    const h = videoTrack.displayHeight;
    const longEdge = Math.max(w, h);

    // ── Skip heuristic ──────────────────────────────────────────────────
    // A source that is already small AND already densely keyframed AND
    // directly decodable is its own best proxy — re-encoding would just burn
    // CPU for no seek/quality benefit.
    if (longEdge <= ALREADY_LIGHT_LONG_EDGE) {
      try {
        const [canDecode, gop] = await Promise.all([
          videoTrack.canDecode(),
          estimateGopSeconds(videoTrack, EncodedPacketSink),
        ]);
        if (canDecode && gop <= ALREADY_DENSE_GOP_S) {
          return null; // use the original as its own proxy
        }
      } catch {
        // Couldn't probe — fall through and transcode to be safe.
      }
    }

    // Cap the long edge; never upscale. Even dimensions required by encoders.
    const scale = longEdge > PROXY_MAX_LONG_EDGE ? PROXY_MAX_LONG_EDGE / longEdge : 1;
    const targetWidth = Math.round((w * scale) / 2) * 2;

    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: "in-memory" }),
      target: new BufferTarget(),
    });

    const conversion = await Conversion.init({
      input,
      output,
      video: {
        width: targetWidth,
        codec: "avc",
        bitrate: QUALITY_MEDIUM,
        keyFrameInterval: PROXY_KEYFRAME_INTERVAL_S,
        forceTranscode: true,
      },
    });

    if (!conversion.isValid) return null;

    if (onProgress) {
      conversion.onProgress = (p) => onProgress(p);
    }

    await conversion.execute();

    const buffer = (output.target as InstanceType<typeof BufferTarget>).buffer;
    if (!buffer) return null;
    return new Blob([buffer], { type: "video/mp4" });
  } catch (e) {
    console.warn("Proxy transcode failed (original will be used for preview):", e);
    return null;
  }
}

/**
 * Estimates the source's group-of-pictures length (keyframe interval, seconds)
 * from its first two key packets — a cheap, metadata-only probe. Returns
 * Infinity when there's only one keyframe (a single huge GOP, worst case).
 */
async function estimateGopSeconds(
  videoTrack: import("mediabunny").InputVideoTrack,
  EncodedPacketSink: typeof import("mediabunny").EncodedPacketSink,
): Promise<number> {
  const sink = new EncodedPacketSink(videoTrack);
  const first = await sink.getFirstKeyPacket({ metadataOnly: true });
  if (!first) return Infinity;
  const second = await sink.getNextKeyPacket(first, { metadataOnly: true });
  if (!second) return Infinity;
  return Math.max(0, second.timestamp - first.timestamp);
}
