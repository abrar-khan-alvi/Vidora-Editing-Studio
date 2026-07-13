/**
 * Same-origin proxy for remote media (stock music / SFX / any cross-origin URL).
 *
 * These CDNs serve audio that plays fine in an <audio> element (playback needs
 * no CORS) but can't be *byte-read* by mediabunny — which the editor needs for
 * waveforms and for export. Routing the clip src through our own origin gives
 * mediabunny a CORS-clean, Range-capable URL.
 */
export function proxiedMediaSrc(url: string | undefined | null): string {
  if (!url) return url ?? "";
  // Already fetchable in-browser: local blobs, data URIs, same-origin paths.
  if (
    url.startsWith("blob:") ||
    url.startsWith("data:") ||
    url.startsWith("/") ||
    url.startsWith("opfs://")
  ) {
    return url;
  }
  return `/api/media-proxy?url=${encodeURIComponent(url)}`;
}
