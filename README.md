<h1 align="center">CapCut Clone</h1>

<p align="center">A lightweight, high-performance, browser-based video editor — a client-side CapCut alternative that renders and exports entirely in the browser using WebCodecs, with zero server rendering costs.</p>

<p align="center">Designed &amp; developed by <b>Abrar Khan Alvi</b></p>

---

## Key Features

- **Client-Side Rendering** — Hardware-accelerated preview and MP4 export using WebCodecs and PixiJS v8, entirely in the browser.
- **Multi-Track Timeline** — Layered editing for video, audio, and images with drag-and-drop, splitting, trimming, and snapping.
- **Interactive Canvas** — Real-time viewport preview supporting drag, resize, rotate, and layer re-ordering.
- **Preview Proxies** — Heavy uploads are transcoded off the main thread into seek-friendly proxies (dense keyframes, capped resolution) so editing stays smooth; the original is restored automatically at export for full-quality output.
- **In-Browser Transcription & Captions** — Audio is extracted client-side and transcribed via ElevenLabs Scribe to auto-generate styled captions, keeping the API key server-side.
- **Stock Media Library** — Search and drop in stock video, music, and SFX, streamed through a same-origin, SSRF-guarded media proxy.
- **Effects & Transitions** — Shader-based transitions and effects applied between clips.
- **Local Exporting** — Direct timeline rendering into MP4 files using browser APIs, no server render farm required.
- **Modern UI/UX** — Dark-first interface with a custom purple brand theme, built on Tailwind CSS v4, Radix UI, and Framer Motion.

---

## Tech Stack

| Component | Technology |
| :--- | :--- |
| **Framework** | Next.js 15 (App Router) |
| **Rendering** | PixiJS v8 + WebCodecs |
| **State** | Zustand |
| **Styling** | Tailwind CSS v4 |
| **UI & Animation** | Radix UI, shadcn/ui, Framer Motion |
| **Media Processing** | mediabunny (WebCodecs) |
| **Transcription** | ElevenLabs Scribe (with Deepgram fallback) |
| **Storage** | Browser OPFS + optional Cloudflare R2 / AWS S3 |

---

## Getting Started

### 1. Installation

```bash
npm install
```

### 2. Environment Setup

Copy `.env.sample` to `.env` and configure the keys you need:

```bash
cp .env.sample .env
```

| Variable | Description |
| :--- | :--- |
| `ELEVENLABS_API_KEY` | API key for in-browser audio/video transcription (captions). |
| `PEXELS_API_KEY` | API key for the stock media library. |
| `DEEPGRAM_API_KEY` | Optional fallback transcription provider (URL-based). |
| `R2_*` | Optional Cloudflare R2 / S3 credentials + public CDN domain for cloud asset uploads. Omit to run fully local (OPFS). |

### 3. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Author

**Abrar Khan Alvi**

Built as a portfolio project demonstrating a full client-side video-editing pipeline — proxy generation, browser-native transcoding/transcription, and WebCodecs export.

## Acknowledgements

Built on the open-source [OpenVideo](https://openvideo.dev) rendering engine (`@openvideo/core`, `@openvideo/engine-pixi`, `@openvideo/timeline`). See [`LICENSE`](./LICENSE) for the engine's terms.
