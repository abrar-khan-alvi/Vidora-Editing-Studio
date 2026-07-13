import type { Paragraph, TranscriptObject, Word } from "./types";

/**
 * Maps an ElevenLabs Scribe speech-to-text response into the internal "Combo"
 * transcript shape the caption pipeline already consumes (identical contract to
 * deepgramToCombo). Only `results.main.words` is used downstream to build
 * caption clips, but we populate text/language/paragraphs for parity.
 */

export interface ElevenLabsWord {
  text: string;
  start?: number;
  end?: number;
  /** "word" tokens carry timings; "spacing"/"audio_event" are skipped. */
  type?: "word" | "spacing" | "audio_event";
  speaker_id?: string;
}

export interface ElevenLabsSTTResponse {
  language_code?: string;
  language_probability?: number;
  text?: string;
  words?: ElevenLabsWord[];
}

export function elevenLabsToCombo(
  res: ElevenLabsSTTResponse,
): Partial<TranscriptObject> | null {
  const text = res?.text?.trim();
  if (!text) return null;

  const rawWords = Array.isArray(res.words) ? res.words : [];
  const words: Word[] = rawWords
    .filter(
      (w) => w.type === "word" && typeof w.start === "number" && typeof w.end === "number",
    )
    .map((w) => ({
      word: w.text,
      start: w.start as number,
      end: w.end as number,
      // Scribe reports language-level probability rather than per-word confidence.
      confidence: res.language_probability ?? 1,
    }));

  const start = words[0]?.start ?? 0;
  const end = words[words.length - 1]?.end ?? 0;

  const language = {
    language: res.language_code ?? "en",
    languageName: res.language_code ?? "en",
    confidence: res.language_probability,
  };

  // Downstream caption generation groups by words[], so a single covering
  // paragraph is sufficient (kept for shape parity with deepgramToCombo).
  const paragraphs: Paragraph[] = words.length
    ? [{ sentences: [{ text, start, end }], numWords: words.length, start, end }]
    : [];

  return {
    duration: end,
    results: {
      main: { language, paragraphs, text, words },
    },
  };
}
