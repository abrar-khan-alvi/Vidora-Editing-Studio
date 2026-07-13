// app/api/transcribe/route.ts
import { NextResponse } from "next/server";
import { transcribe } from "@/lib/transcribe";
import { transcribeWithElevenLabs } from "@/lib/transcribe/elevenlabs";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";

    // Preferred path: the browser uploads audio bytes as multipart/form-data.
    // This is the only path that works for local/OPFS media (blob: URLs the
    // server can't fetch) and keeps the ElevenLabs key server-side.
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof Blob)) {
        return NextResponse.json({ message: "Audio file is required" }, { status: 400 });
      }
      const language = (form.get("language") as string) || undefined;
      const fileName = (file instanceof File && file.name) || "audio.webm";

      const result = await transcribeWithElevenLabs({ file, fileName, languageCode: language });
      return NextResponse.json(result, { status: 200 });
    }

    // Fallback path: JSON { url } → Deepgram. Only works for server-fetchable
    // URLs (e.g. media hosted on R2), not local blob: URLs.
    const body = await request.json();
    const { url, targetLanguage, language, model } = body;

    if (!url) {
      return NextResponse.json({ message: "Audio URL is required" }, { status: 400 });
    }

    const result = await transcribe({
      url,
      language: targetLanguage || language, // Support both field names
      model: model || "nova-3",
      smartFormat: true,
      paragraphs: true,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Transcription error:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ message: errorMessage }, { status: 500 });
  }
}
