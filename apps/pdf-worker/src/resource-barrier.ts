export type PrintResourceState = Readonly<{
  fontsReady: boolean;
  imagesReady: boolean;
  mapsReady: boolean;
}>;

export type PrintResourceProbe = Readonly<{
  fontsReady(): Promise<boolean> | boolean;
  imagesReady(): Promise<boolean> | boolean;
  mapsReady(): Promise<boolean> | boolean;
}>;

export class PrintResourceBarrierError extends Error {
  readonly code: string;
  readonly state: PrintResourceState;

  constructor(code: string, message: string, state: PrintResourceState) {
    super(message);
    this.name = "PrintResourceBarrierError";
    this.code = code;
    this.state = state;
  }
}

export async function waitForPrintResources(
  probe: PrintResourceProbe,
  options: Readonly<{
    timeoutMs?: number;
    pollMs?: number;
    signal?: AbortSignal;
  }> = {},
): Promise<PrintResourceState> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const pollMs = options.pollMs ?? 50;
  const startedAt = Date.now();
  let state: PrintResourceState = { fontsReady: false, imagesReady: false, mapsReady: false };
  while (Date.now() - startedAt <= timeoutMs) {
    if (options.signal?.aborted) {
      throw new PrintResourceBarrierError("PDF_RENDER_CANCELLED", "PDF rendering was cancelled while waiting for resources.", state);
    }
    state = {
      fontsReady: await probe.fontsReady(),
      imagesReady: await probe.imagesReady(),
      mapsReady: await probe.mapsReady(),
    };
    if (state.fontsReady && state.imagesReady && state.mapsReady) return state;
    await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
  }
  throw new PrintResourceBarrierError("PDF_RESOURCE_TIMEOUT", "Print resources did not become ready before the deadline.", state);
}
