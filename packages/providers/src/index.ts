export * from "./contracts/dto.js";
export * from "./contracts/errors.js";
export * from "./contracts/providers.js";
export * from "./contracts/validation.js";
export * from "./fixture/fixture-provider.js";

import type { ProviderCapabilityMatrix, ProviderSuite } from "./contracts/providers.js";

export function providerCapabilities(provider: ProviderSuite): ProviderCapabilityMatrix {
  return provider.capabilityMatrix;
}
