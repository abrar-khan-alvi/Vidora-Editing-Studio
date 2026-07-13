/**
 * Preview-proxy generation (CapCut-style).
 *
 * Source videos (especially phone recordings / web rips) often have keyframes
 * several seconds apart, which makes every seek re-decode from the last
 * keyframe — play-start takes 1–3s. On upload we re-encode the video once
 * into a seek-friendly proxy (dense keyframes, capped resolution) that the
 * editor uses for preview. The original file is swapped back in at export
 * time, so output quality is untouched.
 */

/** Long-edge cap for proxy resolution — preview only, keeps decode cheap. */
const PROXY_MAX_LONG_EDGE = 1280;
/** Keyframe every 0.5s makes any seek land at most ~15 frames away. */
const PROXY_KEYFRAME_INTERVAL_S = 0.5;

export async function generateVideoProxy(
  file: File | Blob,
  onProgress?: (progress: number) => void,
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
    } = await import("mediabunny");

    const input = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(file),
    });

    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) return null;

    // Cap the long edge; never upscale.
    const w = videoTrack.displayWidth;
    const h = videoTrack.displayHeight;
    const longEdge = Math.max(w, h);
    const scale = longEdge > PROXY_MAX_LONG_EDGE ? PROXY_MAX_LONG_EDGE / longEdge : 1;
    // Even dimensions required by most encoders.
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
    console.warn("Proxy generation failed (original will be used for preview):", e);
    return null;
  }
}
