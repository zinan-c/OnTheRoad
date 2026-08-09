export function GET(_request: Request, context: { params: Promise<{ z: string; x: string; y: string }> }) {
  void context;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" fill="#eef2e8"/><path d="M0 196L256 64M-20 92L276 172" stroke="#fff" stroke-width="18"/><path d="M0 196L256 64M-20 92L276 172" stroke="#b7c4ac" stroke-width="2"/><path d="M30 20v216M118 0v256M220 8v240" stroke="#d7dfd0"/><text x="128" y="128" text-anchor="middle" fill="#657160" font-family="sans-serif" font-size="15">On The Road · Fixture Map</text></svg>`;
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "x-otr-map-provider": "fixture",
    },
  });
}
