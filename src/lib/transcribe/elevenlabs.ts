import { elevenLabsToCombo, type ElevenLabsSTTResponse } from "./elevenlabs-to-combo";
import type { TranscriptObject } from "./types";

const ELEVENLABS_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text";

export interface ElevenLabsTranscribeOptions {
  /** Audio (or video) bytes to transcribe. */
  file: Blob;
  fileName?: string;
  /** Defaults to process.env.ELEVENLABS_API_KEY. */
  apiKey?: string;
  /** Scribe model id, defaults to "scribe_v1". */
  modelId?: string;
  /** ISO language code; omit or "auto" to let Scribe auto-detect. */
  languageCode?: string;
  diarize?: boolean;
  tagAudioEvents?: boolean;
}

/**
 * Transcribes audio bytes with ElevenLabs Scribe and returns the result in the
 * internal Combo transcript shape. The API key stays server-side — this must
 * only ever run inside an API route, never in the browser.
 */
export async function transcribeWithElevenLabs(
  options: ElevenLabsTranscribeOptions,
): Promise<Partial<TranscriptObject> | null> {
  // Trim: env values can carry stray surrounding whitespace.
  const apiKey = (options.apiKey ?? process.env.ELEVENLABS_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("ElevenLabs API key is required");
  if (!options.file) throw new Error("Audio file is required");

  const form = new FormData();
  form.append("file", options.file, options.fileName ?? "audio.webm");
  form.append("model_id", options.modelId ?? "scribe_v1");
  form.append("timestamps_granularity", "word");
  form.append("tag_audio_events", String(options.tagAudioEvents ?? false));
  form.append("diarize", String(options.diarize ?? false));
  if (options.languageCode && options.languageCode !== "auto") {
    form.append("language_code", options.languageCode);
  }

  const response = await fetch(ELEVENLABS_STT_URL, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `ElevenLabs transcription failed (${response.status}): ${detail.slice(0, 300)}`,
    );
  }

  const json = (await response.json()) as ElevenLabsSTTResponse;
  return elevenLabsToCombo(json);
}
