/**
 * Client-side audio extraction for speech-to-text.
 *
 * Before sending media to the transcription API, we extract just the audio and
 * downmix it to mono 16 kHz Opus — the standard input for speech recognition.
 * This shrinks a 100 MB video upload to a few hundred KB and keeps the whole
 * transcription round-trip fast, without ever shipping the video bytes to the
 * server. Runs entirely in the browser via mediabunny (WebCodecs).
 */

/** Speech-optimized target: mono, 16 kHz — plenty for word timings. */
const STT_SAMPLE_RATE = 16000;
const STT_CHANNELS = 1;

export interface ExtractedAudio {
  blob: Blob;
  fileName: string;
}

/**
 * Extracts an audio-only WebM/Opus blob from a media file. Returns `null` when
 * the source has no audio track or extraction fails — callers should fall back
 * to sending the original media (Scribe accepts video too).
 *
 * When `range` is given, only that slice of the source is extracted (seconds);
 * timestamps in the result are re-based to 0 at `range.startSec`.
 */
export async function extractAudioForTranscription(
  file: File | Blob,
  range?: { startSec: number; endSec: number },
): Promise<ExtractedAudio | null> {
  try {
    const {
      ALL_FORMATS,
      Input,
      BlobSource,
      Output,
      BufferTarget,
      WebMOutputFormat,
      Conversion,
      QUALITY_LOW,
    } = await import("mediabunny");

    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });

    const audioTrack = await input.getPrimaryAudioTrack();
    if (!audioTrack) return null;

    const output = new Output({
      format: new WebMOutputFormat(),
      target: new BufferTarget(),
    });

    const conversion = await Conversion.init({
      input,
      output,
      video: { discard: true },
      audio: {
        codec: "opus",
        numberOfChannels: STT_CHANNELS,
        sampleRate: STT_SAMPLE_RATE,
        bitrate: QUALITY_LOW,
        forceTranscode: true,
      },
      ...(range && range.endSec > range.startSec
        ? { trim: { start: Math.max(0, range.startSec), end: range.endSec } }
        : {}),
    });

    if (!conversion.isValid) return null;

    await conversion.execute();

    const buffer = (output.target as InstanceType<typeof BufferTarget>).buffer;
    if (!buffer) return null;

    return { blob: new Blob([buffer], { type: "audio/webm" }), fileName: "audio.webm" };
  } catch (e) {
    console.warn("Audio extraction failed; original media will be sent instead:", e);
    return null;
  }
}
