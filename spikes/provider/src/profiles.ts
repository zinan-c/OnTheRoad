const profiles = {
  "fixture-cn": {
    id: "fixture-cn",
    provider: "here",
    domainCrs: "WGS84",
    endpointMode: "explicit",
    capabilities: { search: true, reverse: true, autocomplete: false }
  },
  "fixture-global": {
    id: "fixture-global",
    provider: "here",
    domainCrs: "WGS84",
    endpointMode: "explicit",
    capabilities: { search: true, reverse: true, autocomplete: false }
  },
  "commercial-required": {
    id: "commercial-required",
    provider: "here",
    domainCrs: "WGS84",
    endpointMode: "explicit",
    capabilities: { search: true, reverse: true, autocomplete: false }
  }
} as const;

export type MapProfileId = keyof typeof profiles;

export function resolveMapProfile(profile: string): (typeof profiles)[MapProfileId] {
  if (!(profile in profiles)) throw new Error("MAP_PROFILE_UNKNOWN");
  return profiles[profile as MapProfileId];
}
