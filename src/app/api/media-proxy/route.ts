import { type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streaming media proxy. Fetches a remote media URL server-side (where CORS
 * doesn't apply) and re-serves the bytes from our own origin so the browser's
 * mediabunny/WebCodecs pipeline can read them for waveforms and export.
 *
 * Forwards Range requests so seeking/streaming works, and blocks non-public
 * hosts to avoid SSRF.
 */

function toPublicHttpUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;

  const host = u.hostname.toLowerCase();
  const isPrivate =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (isPrivate) return null;

  return u;
}

const PASSTHROUGH_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
  "cache-control",
];

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("url");
  if (!target) return new Response("Missing url", { status: 400 });

  const url = toPublicHttpUrl(target);
  if (!url) return new Response("Invalid or disallowed url", { status: 400 });

  const range = req.headers.get("range");

  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), {
      headers: range ? { Range: range } : {},
      redirect: "follow",
    });
  } catch {
    return new Response("Upstream fetch failed", { status: 502 });
  }

  if (!upstream.ok && upstream.status !== 206) {
    return new Response("Upstream error", { status: 502 });
  }

  const headers = new Headers();
  for (const h of PASSTHROUGH_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");
  headers.set("access-control-allow-origin", "*");

  return new Response(upstream.body, { status: upstream.status, headers });
}
