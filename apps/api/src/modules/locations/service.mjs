// @ts-nocheck
import {
  assertLocationTransition,
  assertWgs84Point,
  LocationDomainError,
} from "../../../../../packages/domain/src/location/index.mjs";

export class LocationService {
  constructor({ repository, candidateSigner }) {
    this.repository = repository;
    this.candidateSigner = candidateSigner;
  }

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

  get(ownerId, locationId) {
    return this.repository.getOwned(ownerId, locationId);
  }

  async beginResolving(ownerId, locationId, expectedVersion, options) {
    const current = await this.repository.getOwned(ownerId, locationId);
    assertLocationTransition(current.status, "resolving");
    const location = await this.repository.transition(
      ownerId,
      locationId,
      expectedVersion,
      "resolving",
    );
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

  async applyResult(ownerId, jobId, result) {
    const job = await this.repository.getJobOwned(ownerId, jobId);
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

  async selectCandidate(ownerId, jobId, token, expectedVersion) {
    const job = await this.repository.getJobOwned(ownerId, jobId);
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

  async manuallyAdjust(ownerId, locationId, expectedVersion, point, input = {}) {
    const current = await this.repository.getOwned(ownerId, locationId);
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
