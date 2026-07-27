import { HereAdapter } from "../dist/index.js";

if (process.env.OTR_ENABLE_HERE_SMOKE !== "1") {
  throw new Error("HERE_SMOKE_DISABLED: set OTR_ENABLE_HERE_SMOKE=1 only after explicit network approval");
}
const apiKey = process.env.OTR_HERE_API_KEY;
if (!apiKey) {
  throw new Error("HERE_SMOKE_CONFIG_REQUIRED: OTR_HERE_API_KEY is mandatory");
}
const adapter = new HereAdapter({
  geocodeEndpoint: process.env.OTR_HERE_GEOCODE_ENDPOINT ?? "https://geocode.search.hereapi.com/v1/geocode",
  discoverEndpoint: process.env.OTR_HERE_DISCOVER_ENDPOINT ?? "https://discover.search.hereapi.com/v1/discover",
  reverseGeocodeEndpoint: process.env.OTR_HERE_REVERSE_ENDPOINT ?? "https://revgeocode.search.hereapi.com/v1/revgeocode",
  profile: "commercial-required",
  language: process.env.OTR_HERE_LANGUAGE ?? "en",
  apiKey,
  timeoutMs: Number(process.env.OTR_HERE_TIMEOUT_MS ?? "15000")
});
const candidates = await adapter.search({
  query: process.env.OTR_HERE_QUERY ?? "Shanghai",
  limit: 1
});
process.stdout.write(`${JSON.stringify({
  provider: "here",
  count: candidates.length,
  candidates
}, null, 2)}\n`);
