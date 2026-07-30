import {
  assertLocationTransition,
  assertWgs84Point,
  LocationDomainError,
} from "@on-the-road/domain/location";

export class LocationService {
  /** @param {{repository: any, candidateSigner: any}} options */
  constructor({ repository, candidateSigner }) {
    this.repository = repository;
    this.candidateSigner = candidateSigner;
  }

  /** @param {string} ownerId @param {string} tripId @param {{inputText: string, name?: string}} input */
  create(ownerId, tripId, input) {
    if (!ownerId?.trim() || !tripId?.trim()) {
      throw new LocationDomainError(
        "LOCATION_CONTEXT_REQUIRED",
        "Owner and Trip are required.",
      );
    }
    return this.repository.create({
      ownerId,
      tripId,
      inputText: input.inputText,
      name: input.name ?? input.inputText,
    });
  }

  /** @param {string} ownerId @param {string} locationId */
  get(ownerId, locationId) {
    return this.repository.getOwned(ownerId, locationId);
  }

  /** @param {string} ownerId @param {string} locationId @param {number} expectedVersion @param {{provider: string, query?: string, context?: Record<string, unknown>}} options */
  async beginResolving(ownerId, locationId, expectedVersion, options) {
    const current = /** @type {Record<string, any>} */ (
      await this.repository.getOwned(ownerId, locationId)
    );
    assertLocationTransition(current.status, "resolving");
    const location = /** @type {Record<string, any>} */ (await this.repository.transition(
      ownerId,
      locationId,
      expectedVersion,
      "resolving",
    ));
    const job = await this.repository.createJob({
      tripId: location.tripId,
      locationId,
      provider: options.provider,
      query: options.query ?? location.inputText,
      inputLocationVersion: location.version,
      context: options.context ?? {},
    });
    return { location, job };
  }

  /** @param {string} ownerId @param {string} jobId @param {Record<string, any>} result */
  async applyResult(ownerId, jobId, result) {
    const job = /** @type {Record<string, any>} */ (
      await this.repository.getJobOwned(ownerId, jobId)
    );
    if (!["queued", "running"].includes(job.status)) {
      throw new LocationDomainError(
        "GEOCODING_JOB_ALREADY_FINISHED",
        "Geocoding job is already terminal.",
        409,
      );
    }
    if (!["resolved", "ambiguous", "failed"].includes(result.status)) {
      throw new LocationDomainError(
        "GEOCODING_RESULT_INVALID",
        "Geocoding result status is invalid.",
      );
    }
    let candidates = null;
    let payload = {};
    if (result.status === "resolved") {
      const point = assertWgs84Point(result.candidate.point);
      payload = this.#candidatePayload(result.candidate, point, job.provider);
    } else if (result.status === "ambiguous") {
      if (!Array.isArray(result.candidates) || result.candidates.length < 2) {
        throw new LocationDomainError(
          "GEOCODING_CANDIDATES_REQUIRED",
          "Ambiguous results require at least two candidates.",
        );
      }
      candidates = result.candidates.map((candidate) =>
        this.candidateSigner.sign({
          ownerId,
          tripId: job.tripId,
          locationId: job.locationId,
          locationVersion: job.inputLocationVersion + 1,
          candidate,
        }));
    }
    const location = await this.repository.transition(
      ownerId,
      job.locationId,
      job.inputLocationVersion,
      result.status,
      payload,
    );
    const completedJob = await this.repository.finishJob(
      job.id,
      result.status,
      candidates,
      result.errorCode ?? null,
    );
    return { location, job: completedJob };
  }

  /** @param {string} ownerId @param {string} jobId @param {string} token @param {number} expectedVersion */
  async selectCandidate(ownerId, jobId, token, expectedVersion) {
    const job = /** @type {Record<string, any>} */ (
      await this.repository.getJobOwned(ownerId, jobId)
    );
    if (job.status !== "ambiguous" || !job.candidates?.includes(token)) {
      throw new LocationDomainError(
        "CANDIDATE_NOT_AVAILABLE",
        "Candidate is not available for this job.",
        409,
      );
    }
    const candidate = this.candidateSigner.verify(token, {
      ownerId,
      tripId: job.tripId,
      locationId: job.locationId,
      locationVersion: expectedVersion,
    });
    return this.repository.transition(
      ownerId,
      job.locationId,
      expectedVersion,
      "resolved",
      this.#candidatePayload(candidate, candidate.point, job.provider),
    );
  }

  /** @param {string} ownerId @param {string} locationId @param {number} expectedVersion @param {unknown} point @param {Record<string, unknown>} [input] */
  async manuallyAdjust(ownerId, locationId, expectedVersion, point, input = {}) {
    const current = /** @type {Record<string, any>} */ (
      await this.repository.getOwned(ownerId, locationId)
    );
    const normalizedPoint = assertWgs84Point(point);
    assertLocationTransition(current.status, "resolved", {
      point: normalizedPoint,
      manual: true,
    });
    return this.repository.transition(
      ownerId,
      locationId,
      expectedVersion,
      "resolved",
      {
        ...input,
        point: normalizedPoint,
        manual: true,
        provider: "manual",
        sourceCrs: "EPSG:4326",
      },
    );
  }

  /** @param {Record<string, any>} candidate @param {{longitude: number, latitude: number, crs: "WGS84"}} point @param {string} provider */
  #candidatePayload(candidate, point, provider) {
    return {
      name: candidate.label,
      formattedAddress: candidate.formattedAddress ?? candidate.label,
      countryCode: candidate.countryCode ?? null,
      city: candidate.city ?? null,
      district: candidate.district ?? null,
      point,
      provider,
      providerPlaceId: candidate.providerPlaceId,
      sourceCrs: "EPSG:4326",
      confidence: candidate.confidence ?? null,
    };
  }
}
