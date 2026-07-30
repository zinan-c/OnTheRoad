import { transportModes } from "@on-the-road/config/reference-data";

import {
  TransportModeDomainError,
  assertTransportModeVersion,
  normalizeTransportModeCode,
  normalizeTransportModeCreate,
  normalizeTransportModePatch,
  systemTransportModeDto,
} from "../../../../../packages/domain/src/transport-mode/index.mjs";

type TripOwner = { id: string; ownerId: string };
type LineStyle = "solid" | "dashed" | "dotted" | "arc";

export type TransportModeDto = {
  id: string;
  tripId: string | null;
  ownerId: string | null;
  code: string;
  label: string;
  icon: string;
  color: string;
  lineStyle: LineStyle;
  isSystem: boolean;
  enabled: boolean;
  referenced: boolean;
  version: number;
};

type CreateMode = Pick<
  TransportModeDto,
  "code" | "label" | "icon" | "color" | "lineStyle"
>;
type PatchMode = Partial<Pick<
  TransportModeDto,
  "label" | "icon" | "color" | "lineStyle"
>> & { code?: string };

function notFound(): TransportModeDomainError {
  return new TransportModeDomainError(
    "TRANSPORT_MODE_NOT_FOUND",
    "Transport mode was not found.",
    404,
  );
}

function protectedSystem(): TransportModeDomainError {
  return new TransportModeDomainError(
    "SYSTEM_TRANSPORT_MODE_PROTECTED",
    "System transport modes cannot be changed or disabled.",
    409,
  );
}

export class InMemoryTransportModeRepository {
  readonly #trips = new Map<string, string>();
  readonly #custom = new Map<string, TransportModeDto>();
  readonly #references = new Set<string>();
  #sequence = 0;

  constructor({ trips = [] }: { trips?: TripOwner[] } = {}) {
    for (const trip of trips) this.#trips.set(trip.id, trip.ownerId);
  }

  assertTripOwned(ownerId: string, tripId: string): void {
    if (this.#trips.get(tripId) !== ownerId) throw notFound();
  }

  listCustom(ownerId: string, tripId: string): TransportModeDto[] {
    this.assertTripOwned(ownerId, tripId);
    return [...this.#custom.values()]
      .filter((mode) => mode.ownerId === ownerId && mode.tripId === tripId)
      .map((mode) => this.#withReference(mode));
  }

  getCustomOwned(
    ownerId: string,
    tripId: string,
    modeId: string,
  ): TransportModeDto {
    this.assertTripOwned(ownerId, tripId);
    const mode = this.#custom.get(modeId);
    if (!mode || mode.ownerId !== ownerId || mode.tripId !== tripId) {
      throw notFound();
    }
    return this.#withReference(mode);
  }

  createCustom(
    ownerId: string,
    tripId: string,
    input: CreateMode,
  ): TransportModeDto {
    this.assertTripOwned(ownerId, tripId);
    if (
      transportModes.some(({ code }) => code === input.code)
      || [...this.#custom.values()].some(
        (mode) => mode.tripId === tripId && mode.code === input.code,
      )
    ) {
      throw new TransportModeDomainError(
        "TRANSPORT_MODE_CODE_CONFLICT",
        "Transport mode code already exists in this Trip.",
        409,
        "code",
      );
    }
    const created: TransportModeDto = {
      id: `custom-transport-mode-${++this.#sequence}`,
      tripId,
      ownerId,
      ...input,
      isSystem: false,
      enabled: true,
      referenced: false,
      version: 1,
    };
    this.#custom.set(created.id, created);
    return structuredClone(created);
  }

  updateCustom(
    ownerId: string,
    tripId: string,
    modeId: string,
    patch: Omit<PatchMode, "code">,
    expectedVersion: number,
  ): TransportModeDto {
    const current = this.getCustomOwned(ownerId, tripId, modeId);
    if (current.version !== expectedVersion) {
      throw new TransportModeDomainError(
        "TRANSPORT_MODE_VERSION_CONFLICT",
        "Transport mode version does not match If-Match.",
        409,
      );
    }
    const updated = {
      ...current,
      ...patch,
      version: current.version + 1,
    };
    this.#custom.set(modeId, updated);
    return this.#withReference(updated);
  }

  deactivateCustom(
    ownerId: string,
    tripId: string,
    modeId: string,
    expectedVersion: number,
  ): TransportModeDto {
    const current = this.getCustomOwned(ownerId, tripId, modeId);
    if (current.version !== expectedVersion) {
      throw new TransportModeDomainError(
        "TRANSPORT_MODE_VERSION_CONFLICT",
        "Transport mode version does not match If-Match.",
        409,
      );
    }
    if (!current.enabled) return current;
    const updated = {
      ...current,
      enabled: false,
      version: current.version + 1,
    };
    this.#custom.set(modeId, updated);
    return this.#withReference(updated);
  }

  markReferenced(tripId: string, code: string): void {
    this.#references.add(`${tripId}:${normalizeTransportModeCode(code)}`);
  }

  isReferenced(tripId: string, code: string): boolean {
    return this.#references.has(`${tripId}:${code}`);
  }

  #withReference(mode: TransportModeDto): TransportModeDto {
    return structuredClone({
      ...mode,
      referenced: this.isReferenced(mode.tripId!, mode.code),
    });
  }
}

type Awaitable<T> = T | Promise<T>;
export type TransportModeRepository = {
  assertTripOwned(ownerId: string, tripId: string): Awaitable<void>;
  listCustom(ownerId: string, tripId: string): Awaitable<TransportModeDto[]>;
  createCustom(
    ownerId: string,
    tripId: string,
    input: CreateMode,
  ): Awaitable<TransportModeDto>;
  updateCustom(
    ownerId: string,
    tripId: string,
    modeId: string,
    patch: Omit<PatchMode, "code">,
    expectedVersion: number,
  ): Awaitable<TransportModeDto>;
  deactivateCustom(
    ownerId: string,
    tripId: string,
    modeId: string,
    expectedVersion: number,
  ): Awaitable<TransportModeDto>;
};

export class TransportModeService {
  readonly #repository: TransportModeRepository;

  constructor(repository: TransportModeRepository) {
    this.#repository = repository;
  }

  async list(ownerId: string, tripId: string): Promise<TransportModeDto[]> {
    await this.#repository.assertTripOwned(ownerId, tripId);
    const system = transportModes.map((mode) =>
      systemTransportModeDto(mode) as TransportModeDto
    );
    return [
      ...system,
      ...await this.#repository.listCustom(ownerId, tripId),
    ];
  }

  async create(
    ownerId: string,
    tripId: string,
    input: CreateMode,
  ): Promise<TransportModeDto> {
    return await this.#repository.createCustom(
      ownerId,
      tripId,
      normalizeTransportModeCreate(input) as CreateMode,
    );
  }

  async update(
    ownerId: string,
    tripId: string,
    modeId: string,
    patch: PatchMode,
    { expectedVersion }: { expectedVersion: number },
  ): Promise<TransportModeDto> {
    if (modeId.startsWith("system:")) throw protectedSystem();
    return await this.#repository.updateCustom(
      ownerId,
      tripId,
      modeId,
      normalizeTransportModePatch(patch),
      assertTransportModeVersion(expectedVersion),
    );
  }

  async deactivate(
    ownerId: string,
    tripId: string,
    modeId: string,
    { expectedVersion }: { expectedVersion: number },
  ): Promise<TransportModeDto> {
    if (modeId.startsWith("system:")) throw protectedSystem();
    return await this.#repository.deactivateCustom(
      ownerId,
      tripId,
      modeId,
      assertTransportModeVersion(expectedVersion),
    );
  }

  async remove(
    ownerId: string,
    tripId: string,
    modeId: string,
    options: { expectedVersion: number },
  ): Promise<TransportModeDto> {
    if (modeId.startsWith("system:")) throw protectedSystem();
    return this.deactivate(ownerId, tripId, modeId, options);
  }

  async resolve(
    ownerId: string,
    tripId: string,
    codeInput: string,
  ): Promise<TransportModeDto> {
    const code = normalizeTransportModeCode(codeInput);
    const mode = (await this.list(ownerId, tripId))
      .find((candidate) => candidate.code === code);
    if (!mode) throw notFound();
    return mode;
  }

  async options(
    ownerId: string,
    tripId: string,
    { includeDisabledCode }: { includeDisabledCode?: string } = {},
  ): Promise<Array<TransportModeDto & { warning?: "已停用" }>> {
    const includedCode = includeDisabledCode
      ? normalizeTransportModeCode(includeDisabledCode)
      : null;
    return (await this.list(ownerId, tripId))
      .filter((mode) => mode.enabled || mode.code === includedCode)
      .map((mode) => ({
        ...mode,
        ...(!mode.enabled ? { warning: "已停用" as const } : {}),
      }));
  }
}
