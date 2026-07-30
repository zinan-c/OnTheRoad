import type {
  LocationCandidate,
  LocationGateway,
  LocationSearchAdapter,
  LocationSearchContext,
  LocationSearchTrigger,
  Wgs84Point,
} from "./api.js";
import { renderCandidateList } from "./candidate-list.js";
import { renderResolutionStatus } from "./resolution-status.js";

export type LocationInputStatus =
  | "idle"
  | "typing"
  | "explicit-ready"
  | "searching"
  | "candidates"
  | "ambiguous"
  | "empty"
  | "failed"
  | "resolved"
  | "text-saved";

export type LocationInputState = {
  query: string;
  status: LocationInputStatus;
  candidates: LocationCandidate[];
  selectedCandidateId: string | null;
  error: string | null;
  mapPickRequested: boolean;
  autocompleteEnabled: boolean;
  explicitSearchEnabled: boolean;
};

type LocationContext = LocationSearchContext & {
  locationId?: string;
  jobId?: string;
  expectedVersion?: number;
};

type Options = {
  adapter: LocationSearchAdapter;
  locationGateway: LocationGateway;
  context: LocationContext;
  locale: string;
  debounceMs?: number;
  onMapPickRequested?: () => void;
};

export const LOCATION_RECOVERY_ACTIONS = Object.freeze([
  "retry-search",
  "relocate",
  "pick-on-map",
  "manual-coordinates",
  "save-text",
] as const);

export class LocationInput {
  readonly state: LocationInputState;
  readonly #adapter: LocationSearchAdapter;
  readonly #gateway: LocationGateway;
  readonly #context: LocationContext;
  readonly #locale: string;
  readonly #debounceMs: number;
  readonly #onMapPickRequested: (() => void) | undefined;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #abort: AbortController | null = null;
  #requestSequence = 0;

  constructor(options: Options) {
    if (
      options.debounceMs !== undefined
      && (options.debounceMs < 300 || options.debounceMs > 500)
    ) {
      throw new RangeError("Location debounce must be from 300 to 500ms");
    }
    this.#adapter = options.adapter;
    this.#gateway = options.locationGateway;
    this.#context = options.context;
    this.#locale = options.locale;
    this.#debounceMs = options.debounceMs ?? 400;
    this.#onMapPickRequested = options.onMapPickRequested;
    this.state = {
      query: "",
      status: "idle",
      candidates: [],
      selectedCandidateId: null,
      error: null,
      mapPickRequested: false,
      autocompleteEnabled: options.adapter.capabilities.autocomplete,
      explicitSearchEnabled: options.adapter.capabilities.explicitSearch,
    };
  }

  setQuery(value: string): void {
    this.#clearTimer();
    this.#abort?.abort();
    this.#requestSequence += 1;
    this.state.query = value;
    this.state.candidates = [];
    this.state.selectedCandidateId = null;
    this.state.error = null;
    this.state.mapPickRequested = false;
    if (value.trim().length < 2) {
      this.state.status = "typing";
      return;
    }
    if (!this.#adapter.capabilities.autocomplete) {
      this.state.status = "explicit-ready";
      return;
    }
    this.state.status = "typing";
    const sequence = this.#requestSequence;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#search("autocomplete", sequence);
    }, this.#debounceMs);
  }

  async explicitSearch(): Promise<void> {
    this.#clearTimer();
    if (!this.#adapter.capabilities.explicitSearch) {
      this.state.status = "failed";
      this.state.error = "当前 Provider 不支持显式搜索";
      return;
    }
    if (this.state.query.trim().length < 2) {
      this.state.status = "failed";
      this.state.error = "请至少输入两个字符";
      return;
    }
    const sequence = ++this.#requestSequence;
    await this.#search("explicit", sequence);
  }

  acceptCandidates(candidates: LocationCandidate[]): void {
    this.state.candidates = candidates.map((candidate) => ({
      ...candidate,
    }));
    this.state.selectedCandidateId = null;
    this.state.error = null;
    this.state.status = candidates.length > 1
      ? "ambiguous"
      : candidates.length === 1
        ? "candidates"
        : "empty";
  }

  selectCandidate(candidateId: string): LocationCandidate {
    const candidate = this.state.candidates.find(
      (entry) => entry.candidateId === candidateId,
    );
    if (!candidate) throw new Error("Candidate is not available");
    this.state.selectedCandidateId = candidateId;
    return candidate;
  }

  async submitSelected(): Promise<unknown> {
    const candidate = this.state.candidates.find(
      ({ candidateId }) => candidateId === this.state.selectedCandidateId,
    );
    if (!candidate) throw new Error("Select a candidate before confirming");
    if (
      !this.#gateway.selectCandidate
      || !this.#context.jobId
      || this.#context.expectedVersion === undefined
    ) {
      throw new Error("Candidate selection gateway context is unavailable");
    }
    try {
      const result = await this.#gateway.selectCandidate({
        jobId: this.#context.jobId,
        candidateToken: candidate.candidateId,
        expectedVersion: this.#context.expectedVersion,
        confirmation: { label: candidate.label },
      });
      this.state.status = "resolved";
      this.state.error = null;
      return result;
    } catch (error) {
      const status = (error as { status?: number }).status;
      this.state.status = "failed";
      this.state.error = status === 410
        ? "候选已过期，请重新搜索"
        : messageOf(error, "候选保存失败");
      if (status === 410) this.state.selectedCandidateId = null;
      throw error;
    }
  }

  retrySearch(): Promise<void> {
    return this.explicitSearch();
  }

  async relocate(
    locate: () => Promise<{ latitude: number; longitude: number }>,
  ): Promise<unknown> {
    const position = await locate();
    return this.#savePoint(position.latitude, position.longitude, "device");
  }

  requestMapPick(): void {
    this.state.mapPickRequested = true;
    this.#onMapPickRequested?.();
  }

  applyMapPoint(latitude: number, longitude: number): Promise<unknown> {
    return this.#savePoint(latitude, longitude, "map");
  }

  saveManualCoordinates(
    latitude: number,
    longitude: number,
  ): Promise<unknown> {
    return this.#savePoint(latitude, longitude, "manual");
  }

  async saveText(): Promise<unknown> {
    if (!this.#gateway.saveText) {
      throw new Error("Text-only location gateway is unavailable");
    }
    const inputText = this.state.query.trim();
    if (!inputText) throw new Error("Location text is required");
    const result = await this.#gateway.saveText({
      tripId: this.#context.tripId,
      ...(this.#context.locationId
        ? { locationId: this.#context.locationId }
        : {}),
      ...(this.#context.expectedVersion === undefined
        ? {}
        : { expectedVersion: this.#context.expectedVersion }),
      inputText,
    });
    this.state.status = "text-saved";
    this.state.error = null;
    return result;
  }

  recoveryActions(): Array<typeof LOCATION_RECOVERY_ACTIONS[number]> {
    return [...LOCATION_RECOVERY_ACTIONS];
  }

  dispose(): void {
    this.#clearTimer();
    this.#abort?.abort();
    this.#requestSequence += 1;
  }

  async #search(
    trigger: LocationSearchTrigger,
    sequence: number,
  ): Promise<void> {
    this.#abort?.abort();
    const controller = new AbortController();
    this.#abort = controller;
    this.state.status = "searching";
    this.state.error = null;
    try {
      const result = await this.#adapter.search({
        query: this.state.query.trim(),
        trigger,
        locale: this.#locale,
        context: contextForAdapter(this.#context),
        signal: controller.signal,
      });
      if (
        controller.signal.aborted
        || sequence !== this.#requestSequence
      ) return;
      this.acceptCandidates(result.candidates);
    } catch (error) {
      if (
        controller.signal.aborted
        || sequence !== this.#requestSequence
      ) return;
      this.state.candidates = [];
      this.state.selectedCandidateId = null;
      this.state.status = "failed";
      this.state.error = messageOf(error, "地点搜索失败");
    }
  }

  async #savePoint(
    latitude: number,
    longitude: number,
    source: "device" | "map" | "manual",
  ): Promise<unknown> {
    if (
      !Number.isFinite(latitude)
      || latitude < -90
      || latitude > 90
      || !Number.isFinite(longitude)
      || longitude < -180
      || longitude > 180
    ) {
      throw new RangeError("Coordinates must be valid WGS84 latitude/longitude");
    }
    if (
      !this.#gateway.saveManual
      || !this.#context.locationId
      || this.#context.expectedVersion === undefined
    ) {
      throw new Error("Manual location gateway context is unavailable");
    }
    const point: Wgs84Point = { latitude, longitude, crs: "WGS84" };
    const result = await this.#gateway.saveManual({
      locationId: this.#context.locationId,
      expectedVersion: this.#context.expectedVersion,
      point,
      source,
    });
    this.state.status = "resolved";
    this.state.error = null;
    return result;
  }

  #clearTimer(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }
}

function contextForAdapter(context: LocationContext): LocationSearchContext {
  return {
    tripId: context.tripId,
    ...(context.city ? { city: context.city } : {}),
    ...(context.countryCode ? { countryCode: context.countryCode } : {}),
    ...(context.proximity ? { proximity: { ...context.proximity } } : {}),
  };
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderLocationInput(state: LocationInputState): string {
  const candidateList = renderCandidateList(
    state.candidates,
    state.selectedCandidateId,
  );
  const resolution = renderResolutionStatus(state.status, state.error);
  return `<section aria-labelledby="location-input-label"><label id="location-input-label" for="location-query">地点</label><input id="location-query" name="location" value="${escapeHtml(state.query)}" autocomplete="${state.autocompleteEnabled ? "street-address" : "off"}">${state.explicitSearchEnabled ? '<button data-action="explicit-search">搜索</button>' : ""}${!state.autocompleteEnabled ? "<p>当前服务需要点击搜索</p>" : ""}${resolution}${candidateList}</section>`;
}
