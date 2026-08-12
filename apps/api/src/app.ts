import { randomUUID } from "node:crypto";

import {
  Body,
  Controller,
  Delete,
  ExceptionFilter,
  Catch,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Module,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import { acceptRequestContext, injectTraceHeaders } from "@on-the-road/observability";

import { toProblemDetails, ProblemDetailsError } from "./common/problem-details/index.mjs";
import type { ApiRuntime } from "./runtime.js";
import { apiTelemetry, type ApiTelemetry } from "./telemetry.js";

const RUNTIME = Symbol("API_RUNTIME");

function cookie(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers.cookie
    ?.split(";")
    .map((entry) => entry.trim().split("="))
    .find(([key]) => key === name)?.[1];
  return value ? decodeURIComponent(value) : undefined;
}

async function owner(runtime: ApiRuntime, request: FastifyRequest): Promise<string> {
  const token = cookie(request, runtime.identity.sessionCookieName);
  if (!token) {
    throw new ProblemDetailsError({
      status: 401,
      code: "SESSION_REQUIRED",
      title: "Authentication required",
    });
  }
  return (await runtime.identity.authenticate(token)).id;
}

function version(value: string | undefined): number {
  const parsed = Number(value?.replaceAll("\"", ""));
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new ProblemDetailsError({
      status: 428,
      code: "IF_MATCH_REQUIRED",
      title: "A valid If-Match version is required",
    });
  }
  return parsed;
}

@Catch()
class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: import("@nestjs/common").ArgumentsHost) {
    const response = host.switchToHttp().getResponse<FastifyReply>();
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    const candidate = error && typeof error === "object"
      ? error as { status?: number; code?: string; message?: string }
      : {};
    const safe = error instanceof ProblemDetailsError
      ? error
      : new ProblemDetailsError({
        status: candidate.status && candidate.status >= 400 && candidate.status < 600
          ? candidate.status
          : 500,
        code: candidate.code?.match(/^[A-Z][A-Z0-9_]*$/u)
          ? candidate.code
          : "INTERNAL_ERROR",
        title: candidate.status && candidate.status < 500
          ? candidate.message || "Request rejected"
          : "Internal server error",
        ...(candidate.status && candidate.status < 500 && candidate.message
          ? { detail: candidate.message }
          : {}),
        instance: request.url,
      });
    const problem = toProblemDetails(
      safe,
      String(request.headers["x-request-id"] ?? randomUUID()),
    );
    void response
      .status(problem.status)
      .type("application/problem+json")
      .send(problem);
  }
}

@Controller()
class HealthController {
  constructor(@Inject(RUNTIME) private readonly runtime: ApiRuntime) {}

  @Get("health/live")
  live() {
    return { status: "live" };
  }

  @Get("health/ready")
  async ready(@Res({ passthrough: true }) reply: FastifyReply) {
    const dependencies = await this.runtime.checkReadiness();
    const ready = Object.values(dependencies).every(Boolean);
    reply.status(ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ready ? "ready" : "not_ready", dependencies };
  }
}

@Controller("api/v1")
class ApiController {
  constructor(@Inject(RUNTIME) private readonly runtime: ApiRuntime) {}

  @Post("identity/development-session")
  async developmentSession(
    @Body() body: { subject?: string },
    @Headers("origin") origin: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.runtime.identity.loginWithDevelopmentIdentity({
      subject: body.subject ?? "",
      origin: origin ?? this.runtime.appOrigin,
    });
    reply.header("set-cookie", result.setCookie);
    return { principal: result.principal };
  }

  @Get("identity/oidc/authorize")
  async beginOidcAuthorization(
    @Res() reply: FastifyReply,
  ) {
    if (!this.runtime.oidcProvider) {
      throw new ProblemDetailsError({
        status: 503,
        code: "OIDC_PROVIDER_UNAVAILABLE",
        title: "OIDC provider is unavailable",
      });
    }
    const result = await this.runtime.identity.beginOidcAuthorization({
      provider: this.runtime.oidcProvider,
    });
    return reply
      .header("set-cookie", result.setCookie)
      .redirect(result.authorizationUrl);
  }

  @Get("identity/oidc/callback")
  async completeOidcAuthorization(
    @Req() request: FastifyRequest,
    @Query("code") code: string,
    @Query("state") state: string,
    @Headers("origin") origin: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    if (!this.runtime.oidcProvider) {
      throw new ProblemDetailsError({
        status: 503,
        code: "OIDC_PROVIDER_UNAVAILABLE",
        title: "OIDC provider is unavailable",
      });
    }
    const result = await this.runtime.identity.completeOidcAuthorization({
      provider: this.runtime.oidcProvider,
      code,
      state,
      transactionCookie: cookie(
        request,
        this.runtime.identity.transactionCookieName,
      ) ?? "",
      origin: origin ?? this.runtime.appOrigin,
    });
    return reply
      .headers({
        "set-cookie": [
          result.setCookie,
          result.clearTransactionCookie,
        ],
      })
      .redirect(this.runtime.appOrigin);
  }

  @Get("identity/session")
  async session(@Req() request: FastifyRequest) {
    return { principal: await this.runtime.identity.authenticate(
      cookie(request, this.runtime.identity.sessionCookieName) ?? "",
    ) };
  }

  @Delete("identity/session")
  async logout(
    @Req() request: FastifyRequest,
    @Headers("origin") origin: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.runtime.identity.logout({
      token: cookie(request, this.runtime.identity.sessionCookieName) ?? "",
      origin: origin ?? this.runtime.appOrigin,
    });
    reply.header("set-cookie", result.setCookie).status(HttpStatus.NO_CONTENT);
  }

  @Get("system/reference-data")
  referenceData() {
    return this.runtime.referenceData();
  }

  @Get("system/capabilities")
  capabilities() {
    const map = this.runtime.locationSearch.capabilities();
    return {
      geocoding: map.search,
      reverseGeocoding: map.reverse,
      directions: map.provider === "fixture",
      staticMaps: map.provider === "fixture",
      imports: true,
      exports: false,
    };
  }

  @Post("trips")
  async createTrip(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const trip = await this.runtime.trips.createTrip(await owner(this.runtime, request), body, {
      idempotencyKey,
    });
    reply.status(HttpStatus.CREATED).header("etag", String(trip.version));
    return trip;
  }

  @Get("trips")
  async listTrips(
    @Req() request: FastifyRequest,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.runtime.trips.listTrips(await owner(this.runtime, request), {
      ...(query.limit ? { limit: Number(query.limit) } : {}),
      ...(query.search ? { search: query.search } : {}),
      ...(query.currency ? { currency: query.currency } : {}),
      ...(query.status ? { status: query.status } : {}),
    });
  }

  @Get("trips/:tripId")
  async getTrip(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const trip = await this.runtime.trips.getTrip(await owner(this.runtime, request), tripId);
    reply.header("etag", String(trip.version));
    return trip;
  }

  @Patch("trips/:tripId")
  async updateTrip(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const trip = await this.runtime.trips.updateTrip(
      await owner(this.runtime, request),
      tripId,
      body,
      { expectedVersion: version(ifMatch) },
    );
    reply.header("etag", String(trip.version));
    return trip;
  }

  @Delete("trips/:tripId")
  async deleteTrip(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const trip = await this.runtime.trips.deleteTrip(
      await owner(this.runtime, request),
      tripId,
      { expectedVersion: version(ifMatch) },
    );
    reply.header("etag", String(trip.version));
    return trip;
  }

  @Post("trips/:tripId/restore")
  @HttpCode(HttpStatus.OK)
  async restoreTrip(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const trip = await this.runtime.trips.restoreTrip(
      await owner(this.runtime, request),
      tripId,
      { expectedVersion: version(ifMatch) },
    );
    reply.header("etag", String(trip.version));
    return trip;
  }

  @Patch("trips/:tripId/dates")
  async changeTripDates(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: {
      startDate: string;
      endDate: string;
      removedDayPolicy?: string;
    },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const ownerId = await owner(this.runtime, request);
    const before = await this.runtime.tripDates.list(ownerId, tripId) as Array<{ id: string }>;
    const context = await this.runtime.tripDates.apply(
      ownerId,
      tripId,
      {
        startDate: body.startDate,
        endDate: body.endDate,
        expectedVersion: version(ifMatch),
        confirmDestructive: body.removedDayPolicy === "confirm_remove",
      },
    );
    const after = (context as { days?: Array<{ id: string }> }).days ?? [];
    const beforeIds = new Set(before.map(({ id }) => id));
    const afterIds = new Set(after.map(({ id }) => id));
    const trip = await this.runtime.trips.getTrip(ownerId, tripId);
    const result = {
      trip,
      createdDayIds: after.filter(({ id }) => !beforeIds.has(id)).map(({ id }) => id),
      archivedDayIds: before.filter(({ id }) => !afterIds.has(id)).map(({ id }) => id),
    };
    const resultVersion = (trip as { version?: number }).version;
    if (resultVersion) reply.header("etag", String(resultVersion));
    return result;
  }

  @Get("trips/:tripId/days")
  async listTripDays(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
  ) {
    return this.runtime.tripDates.list(
      await owner(this.runtime, request),
      tripId,
    );
  }

  @Get("trips/:tripId/routes")
  async listRoutes(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
  ) {
    return this.runtime.routes.list(
      await owner(this.runtime, request),
      tripId,
    );
  }

  @Get("trips/:tripId/routes/status")
  async routeStatus(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
  ) {
    return this.runtime.routes.status(
      await owner(this.runtime, request),
      tripId,
    );
  }

  @Post("trips/:tripId/days/:tripDayId/itinerary-items")
  async createItem(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
    @Param("tripDayId") tripDayId: string,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const item = await this.runtime.itinerary.create(
      await owner(this.runtime, request),
      tripId,
      { ...body, tripDayId },
    );
    const versioned = item as typeof item & { version: number };
    reply.status(HttpStatus.CREATED).header("etag", String(versioned.version));
    return item;
  }

  @Get("trips/:tripId/days/:tripDayId/itinerary-items")
  async listItems(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
    @Param("tripDayId") tripDayId: string,
  ) {
    return this.runtime.itinerary.listDay(
      await owner(this.runtime, request),
      tripId,
      tripDayId,
    );
  }

  @Post("trips/:tripId/days/:tripDayId/itinerary-items/reorder")
  @HttpCode(HttpStatus.OK)
  async reorderItems(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
    @Param("tripDayId") tripDayId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.runtime.itineraryOrder.reorder(
      await owner(this.runtime, request),
      tripId,
      tripDayId,
      body,
    );
    const resultVersion = (result as { version?: number }).version;
    if (resultVersion) reply.header("etag", String(resultVersion));
    return result;
  }

  @Get("trips/:tripId/transport-modes")
  async listTransportModes(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
  ) {
    return this.runtime.transportModes.list(await owner(this.runtime, request), tripId);
  }

  @Post("trips/:tripId/transport-modes")
  async createTransportMode(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
    @Body() body: Parameters<ApiRuntime["transportModes"]["create"]>[2],
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const created = await this.runtime.transportModes.create(
      await owner(this.runtime, request),
      tripId,
      body,
    );
    reply.status(HttpStatus.CREATED).header("etag", String(created.version));
    return created;
  }

  @Patch("trips/:tripId/transport-modes/:modeId")
  async updateTransportMode(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
    @Param("modeId") modeId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: Parameters<ApiRuntime["transportModes"]["update"]>[3],
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const updated = await this.runtime.transportModes.update(
      await owner(this.runtime, request),
      tripId,
      modeId,
      body,
      { expectedVersion: version(ifMatch) },
    );
    reply.header("etag", String(updated.version));
    return updated;
  }

  @Delete("trips/:tripId/transport-modes/:modeId")
  async deactivateTransportMode(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
    @Param("modeId") modeId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const deactivated = await this.runtime.transportModes.deactivate(
      await owner(this.runtime, request),
      tripId,
      modeId,
      { expectedVersion: version(ifMatch) },
    );
    reply.header("etag", String(deactivated.version));
    return deactivated;
  }

  @Get("trips/:tripId/itinerary-items/:itemId")
  async getItem(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
    @Param("itemId") itemId: string,
  ) {
    return this.runtime.itinerary.get(
      await owner(this.runtime, request),
      tripId,
      itemId,
    );
  }

  @Patch("trips/:tripId/itinerary-items/:itemId")
  async updateItem(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
    @Param("itemId") itemId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const item = await this.runtime.itinerary.update(
      await owner(this.runtime, request),
      tripId,
      itemId,
      body,
      { expectedVersion: version(ifMatch) },
    );
    reply.header(
      "etag",
      String((item as unknown as { version: number }).version),
    );
    return item;
  }

  @Delete("trips/:tripId/itinerary-items/:itemId")
  async deleteItem(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
    @Param("itemId") itemId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const item = await this.runtime.itinerary.delete(
      await owner(this.runtime, request),
      tripId,
      itemId,
      { expectedVersion: version(ifMatch) },
    );
    reply.header(
      "etag",
      String((item as unknown as { version: number }).version),
    );
    return item;
  }

  @Post("trips/:tripId/itinerary-items/:itemId/copy")
  async copyItem(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
    @Param("itemId") itemId: string,
    @Body() body: { targetTripDayId: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.status(HttpStatus.CREATED);
    return this.runtime.itinerary.copy(
      await owner(this.runtime, request),
      tripId,
      itemId,
      body.targetTripDayId,
    );
  }

  @Post("trips/:tripId/locations")
  async createLocation(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
    @Body() body: { inputText: string; name?: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.status(HttpStatus.CREATED);
    return this.runtime.locations.create(await owner(this.runtime, request), tripId, body);
  }

  @Get("trips/:tripId/locations/search")
  async searchLocations(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
    @Query("q") query: string,
    @Query("limit") limit?: string,
  ) {
    const ownerId = await owner(this.runtime, request);
    const trip = await this.runtime.trips.getTrip(ownerId, tripId) as unknown as { mapProfile?: string };
    return this.runtime.locationSearch.search({
      query,
      ...(limit ? { limit: Number(limit) } : {}),
      ...(trip.mapProfile ? { context: { mapProfile: trip.mapProfile } } : {}),
      trigger: "explicit",
    });
  }

  @Get("trips/:tripId/locations/:locationId")
  async getLocation(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
    @Param("locationId") locationId: string,
  ) {
    const ownerId = await owner(this.runtime, request);
    const location = await this.runtime.locations.get(ownerId, locationId) as { tripId?: string };
    if (location.tripId !== tripId) {
      throw new ProblemDetailsError({ status: 404, code: "LOCATION_NOT_FOUND", title: "Location was not found" });
    }
    return location;
  }

  @Post("trips/:tripId/locations/:locationId/search")
  @HttpCode(HttpStatus.OK)
  async searchLocationCandidates(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
    @Param("locationId") locationId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: { query: string; limit?: number },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const ownerId = await owner(this.runtime, request);
    const trip = await this.runtime.trips.getTrip(ownerId, tripId) as unknown as { mapProfile?: string };
    const current = await this.runtime.locations.get(ownerId, locationId) as { tripId?: string; version: number };
    if (current.tripId !== tripId) {
      throw new ProblemDetailsError({ status: 404, code: "LOCATION_NOT_FOUND", title: "Location was not found" });
    }
    const capabilities = this.runtime.locationSearch.capabilities();
    if (capabilities.provider !== "fixture" && trip.mapProfile !== capabilities.mapProfile) {
      throw new ProblemDetailsError({
        status: 409,
        code: "MAP_PROFILE_MISMATCH",
        title: "Trip map profile is not available in this deployment",
      });
    }
    const started = await this.runtime.locations.beginResolving(
      ownerId,
      locationId,
      version(ifMatch),
      { provider: capabilities.provider, query: body.query, context: { mapProfile: trip.mapProfile, trigger: "explicit" } },
    );
    try {
      const result = await this.runtime.locationSearch.searchForResolution({
        query: body.query,
        ...(body.limit ? { limit: body.limit } : {}),
        trigger: "explicit",
      });
      if (result.candidates.length === 0) {
        const failed = await this.runtime.locations.applyResult(ownerId, started.job.id, { status: "failed", errorCode: "NO_RESULTS" });
        reply.header("etag", String(failed.location.version));
        return { ...failed, provider: result.provider, mapProfile: trip.mapProfile ?? result.mapProfile, attribution: result.attribution, candidates: [] };
      }
      const signable = result.candidates.map((candidate) => ({
        ...candidate,
        providerPlaceId: candidate.id,
      }));
      const offered = await this.runtime.locations.applyResult(ownerId, started.job.id, {
        status: "ambiguous",
        candidates: signable,
      });
      reply.header("etag", String(offered.location.version));
      return {
        location: offered.location,
        job: { ...offered.job, candidates: undefined },
        provider: result.provider,
        mapProfile: trip.mapProfile ?? result.mapProfile,
        attribution: result.attribution,
        candidates: signable.map((candidate, index) => ({
          label: candidate.label,
          formattedAddress: candidate.formattedAddress ?? candidate.label,
          countryCode: candidate.countryCode ?? null,
          city: candidate.city ?? null,
          district: candidate.district ?? null,
          point: candidate.point,
          attribution: candidate.attribution,
          provider: candidate.provider,
          selected: false,
          candidateToken: offered.job.candidates[index],
        })),
      };
    } catch (caught) {
      await this.runtime.locations.applyResult(ownerId, started.job.id, { status: "failed", errorCode: "PROVIDER_FAILED" }).catch(() => undefined);
      throw caught;
    }
  }

  @Patch("trips/:tripId/locations/:locationId/coordinates")
  async adjustCoordinates(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
    @Param("locationId") locationId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: {
      latitude: number;
      longitude: number;
      formattedAddress?: string;
      adjustmentKind?: "map-pick" | "marker-drag" | "manual";
      inputMode?: "mouse" | "touch" | "keyboard" | "manual";
    },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const ownerId = await owner(this.runtime, request);
    const current = await this.runtime.locationCoordinates.get(ownerId, locationId);
    const actualTripId = (current.location as unknown as { tripId?: string }).tripId;
    if (actualTripId !== undefined && actualTripId !== tripId) {
      throw new ProblemDetailsError({ status: 404, code: "LOCATION_NOT_FOUND", title: "Location was not found" });
    }
    const point = { latitude: body.latitude, longitude: body.longitude, crs: "WGS84" as const };
    const headers = { ifMatch: `"${version(ifMatch)}"` };
    const result = body.adjustmentKind === "map-pick"
      ? await this.runtime.locationCoordinates.pick(ownerId, locationId, { point }, headers)
      : body.adjustmentKind === "marker-drag"
        ? await this.runtime.locationCoordinates.drag(ownerId, locationId, { point, inputMode: body.inputMode ?? "mouse" }, headers)
        : await this.runtime.locationCoordinates.manual(ownerId, locationId, { point }, headers);
    reply.header("etag", result.etag);
    return result.location;
  }

  @Post("trips/:tripId/locations/:locationId/candidate")
  @HttpCode(HttpStatus.OK)
  async confirmLocationCandidate(
    @Req() request: FastifyRequest,
    @Param("locationId") locationId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: { jobId: string; candidateToken: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const location = await this.runtime.locations.selectCandidate(
      await owner(this.runtime, request),
      body.jobId,
      body.candidateToken,
      version(ifMatch),
    );
    reply.header("etag", String((location as { version: number }).version));
    return location;
  }

  @Post("trips/:tripId/attachments/upload-sessions")
  async createAttachmentUploadSession(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
    @Body() body: {
      itineraryItemId?: string;
      contentType: string;
      contentLength: number;
      checksumSha256: string;
    },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const session = await this.runtime.attachments.createSession({
      ownerId: await owner(this.runtime, request),
      tripId,
      ...(body.itineraryItemId ? { itemId: body.itineraryItemId } : {}),
      contentType: body.contentType,
      contentLength: body.contentLength,
      checksumSha256: body.checksumSha256,
    });
    reply.status(HttpStatus.CREATED);
    return session;
  }

  @Get("trips/:tripId/itinerary-items/:itemId/gallery")
  async gallery(
    @Req() request: FastifyRequest,
    @Param("itemId") itemId: string,
  ) { return this.runtime.gallery.list(await owner(this.runtime, request), itemId); }

  @Post("trips/:tripId/itinerary-items/:itemId/gallery/reorder")
  async reorderGallery(
    @Req() request: FastifyRequest,
    @Param("itemId") itemId: string,
    @Body() body: {
      expectedVersion?: number;
      expectedVersions?: Record<string, number>;
      orderedIds?: string[];
    },
  ) {
    return this.runtime.gallery.reorder(
      await owner(this.runtime, request),
      itemId,
      body.expectedVersions ?? Number(body.expectedVersion),
      body.orderedIds ?? [],
    );
  }

  @Patch("trips/:tripId/attachments/:attachmentId/gallery")
  async updateGallery(
    @Req() request: FastifyRequest,
    @Param("attachmentId") attachmentId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: Record<string, unknown>,
  ) { return this.runtime.gallery.update(await owner(this.runtime, request), attachmentId, version(ifMatch), body); }

  @Delete("trips/:tripId/attachments/:attachmentId/gallery")
  async removeGallery(
    @Req() request: FastifyRequest,
    @Param("attachmentId") attachmentId: string,
  ) { return this.runtime.gallery.remove(await owner(this.runtime, request), attachmentId); }

  @Post("trips/:tripId/attachments/:attachmentId/complete")
  async completeAttachmentUpload(
    @Req() request: FastifyRequest,
    @Param("attachmentId") attachmentId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const attachment = await this.runtime.attachments.complete({
      ownerId: await owner(this.runtime, request),
      attachmentId,
    });
    reply.status(HttpStatus.ACCEPTED);
    return attachment;
  }

  @Post("trips/:tripId/attachments/:attachmentId/retry")
  async retryAttachment(
    @Req() request: FastifyRequest,
    @Param("attachmentId") attachmentId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const attachment = await this.runtime.attachments.retry({
      ownerId: await owner(this.runtime, request),
      attachmentId,
    });
    reply.status(HttpStatus.ACCEPTED);
    return attachment;
  }

  @Post("trips/:tripId/expenses")
  async createExpense(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const expense = await this.runtime.expenses.create(
      await owner(this.runtime, request),
      tripId,
      body,
    );
    reply.status(HttpStatus.CREATED);
    return expense;
  }

  @Get("trips/:tripId/itinerary-items/:itemId/expenses")
  async itemExpenses(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
    @Param("itemId") itemId: string,
  ) {
    return this.runtime.expenses.listForItem(await owner(this.runtime, request), tripId, itemId);
  }

  @Patch("trips/:tripId/expenses/:expenseId")
  async updateExpense(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
    @Param("expenseId") expenseId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.runtime.expenses.update(
      await owner(this.runtime, request), tripId, expenseId, body, version(ifMatch),
    );
  }

  @Get("trips/:tripId/expenses/summary")
  async expenseSummary(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
  ) {
    return this.runtime.expenses.summary(
      await owner(this.runtime, request),
      tripId,
    );
  }

  @Put("trips/:tripId/exchange-rates")
  async setExchangeRate(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.runtime.expenses.setRate(
      await owner(this.runtime, request),
      tripId,
      body,
    );
  }

  @Get("trips/:tripId/exchange-rates")
  async listExchangeRates(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
  ) {
    return this.runtime.expenses.listRates(
      await owner(this.runtime, request),
      tripId,
    );
  }

  @Post("trips/:tripId/imports/uploads")
  async createImportUpload(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (!this.runtime.imports) {
      throw new ProblemDetailsError({
        status: 503,
        code: "IMPORT_TRANSPORT_UNAVAILABLE",
        title: "Import transport is unavailable",
      });
    }
    const upload = await this.runtime.imports.createUpload({
      ...body,
      ownerId: await owner(this.runtime, request),
      tripId,
    });
    reply.status(HttpStatus.CREATED);
    return upload;
  }

  @Get("imports/:jobId/mapping")
  async getImportMapping(
    @Req() request: FastifyRequest,
    @Param("jobId") jobId: string,
  ) {
    if (!this.runtime.importMapping) {
      throw new ProblemDetailsError({ status: 503, code: "IMPORT_MAPPING_UNAVAILABLE", title: "Import mapping is unavailable" });
    }
    return this.runtime.importMapping.get(await owner(this.runtime, request), jobId);
  }

  @Post("trips/:tripId/imports/:attachmentId/complete")
  async completeImportUpload(
    @Req() request: FastifyRequest,
    @Param("attachmentId") attachmentId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (!this.runtime.imports?.completeUpload) {
      throw new ProblemDetailsError({ status: 503, code: "IMPORT_TRANSPORT_UNAVAILABLE", title: "Import transport is unavailable" });
    }
    reply.status(HttpStatus.ACCEPTED);
    return this.runtime.imports.completeUpload({ ownerId: await owner(this.runtime, request), attachmentId });
  }

  @Get("trips/:tripId/imports/latest")
  async latestImport(@Req() request: FastifyRequest, @Param("tripId") tripId: string) {
    if (!this.runtime.importMapping) throw new ProblemDetailsError({ status: 503, code: "IMPORT_MAPPING_UNAVAILABLE", title: "Import mapping is unavailable" });
    return this.runtime.importMapping.latest(await owner(this.runtime, request), tripId);
  }

  @Put("imports/:jobId/mapping")
  async saveImportMapping(
    @Req() request: FastifyRequest,
    @Param("jobId") jobId: string,
    @Body() body: Record<string, unknown>,
  ) {
    if (!this.runtime.importMapping) {
      throw new ProblemDetailsError({ status: 503, code: "IMPORT_MAPPING_UNAVAILABLE", title: "Import mapping is unavailable" });
    }
    const input = {
      mapping: body.mapping as Record<string, string>,
      sourceColumns: body.sourceColumns as string[],
      ...(Array.isArray(body.requiredTargets) ? { requiredTargets: body.requiredTargets as string[] } : {}),
      ...(Array.isArray(body.sheetNames) ? { sheetNames: body.sheetNames as string[] } : {}),
      ...(typeof body.expectedVersion === "number" ? { expectedVersion: body.expectedVersion } : {}),
    };
    return this.runtime.importMapping.save(await owner(this.runtime, request), jobId, input);
  }

  @Get("imports/:jobId/preview")
  async importPreview(
    @Req() request: FastifyRequest,
    @Param("jobId") jobId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.runtime.importPreview.list(await owner(this.runtime, request), jobId, {
      ...(query.status ? { status: query.status } : {}),
      ...(query.query ? { query: query.query } : {}),
      ...(query.page ? { page: Number(query.page) } : {}),
      ...(query.pageSize ? { pageSize: Number(query.pageSize) } : {}),
    });
  }

  @Post("imports/:jobId/preview/skip")
  async skipImportPreview(@Req() request: FastifyRequest, @Param("jobId") jobId: string, @Body() body: { ids?: string[] }) {
    return this.runtime.importPreview.skip(await owner(this.runtime, request), jobId, body.ids ?? []);
  }

  @Post("trips/:tripId/imports/:attachmentId/inspection")
  async queueImportInspection(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
    @Param("attachmentId") attachmentId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (!this.runtime.imports) {
      throw new ProblemDetailsError({
        status: 503,
        code: "IMPORT_TRANSPORT_UNAVAILABLE",
        title: "Import transport is unavailable",
      });
    }
    const job = await this.runtime.imports.queueInspection({
      ownerId: await owner(this.runtime, request),
      tripId,
      attachmentId,
    });
    reply.status(HttpStatus.ACCEPTED);
    return job;
  }

  @Get("imports/:jobId/commit")
  async getImportCommit(
    @Req() request: FastifyRequest,
    @Param("jobId") jobId: string,
  ) {
    if (!this.runtime.importCommit) {
      throw new ProblemDetailsError({ status: 503, code: "IMPORT_COMMIT_UNAVAILABLE", title: "Import commit is unavailable" });
    }
    return this.runtime.importCommit.getCommitJob(await owner(this.runtime, request), jobId);
  }

  @Post("imports/:jobId/commit")
  @HttpCode(HttpStatus.ACCEPTED)
  async commitImport(
    @Req() request: FastifyRequest,
    @Param("jobId") jobId: string,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    if (!this.runtime.importCommit) {
      throw new ProblemDetailsError({ status: 503, code: "IMPORT_COMMIT_UNAVAILABLE", title: "Import commit is unavailable" });
    }
    return this.runtime.importCommit.startCommit(
      await owner(this.runtime, request),
      jobId,
      ...(idempotencyKey ? [{ idempotencyKey }] : []),
    );
  }

  @Post("imports/:jobId/cancel")
  @HttpCode(HttpStatus.ACCEPTED)
  async cancelImport(
    @Req() request: FastifyRequest,
    @Param("jobId") jobId: string,
  ) {
    if (!this.runtime.importCommit) {
      throw new ProblemDetailsError({ status: 503, code: "IMPORT_COMMIT_UNAVAILABLE", title: "Import commit is unavailable" });
    }
    return this.runtime.importCommit.cancelCommit(await owner(this.runtime, request), jobId);
  }

  @Post("imports/:jobId/resume")
  @HttpCode(HttpStatus.ACCEPTED)
  async resumeImport(
    @Req() request: FastifyRequest,
    @Param("jobId") jobId: string,
  ) {
    if (!this.runtime.importCommit) {
      throw new ProblemDetailsError({ status: 503, code: "IMPORT_COMMIT_UNAVAILABLE", title: "Import commit is unavailable" });
    }
    return this.runtime.importCommit.resumeCommit(await owner(this.runtime, request), jobId);
  }

  @Post("imports/:jobId/rows/:rowId/override")
  @HttpCode(HttpStatus.OK)
  async overrideImportRow(
    @Req() request: FastifyRequest,
    @Param("jobId") jobId: string,
    @Param("rowId") rowId: string,
    @Body() body: { reason?: string },
  ) {
    if (!this.runtime.importCommit) {
      throw new ProblemDetailsError({ status: 503, code: "IMPORT_COMMIT_UNAVAILABLE", title: "Import commit is unavailable" });
    }
    return this.runtime.importCommit.createOverrideDecision(await owner(this.runtime, request), jobId, {
      rowId,
      reason: body.reason ?? "",
    });
  }

  @Get("imports/:jobId/media-tasks")
  async listImportMediaTasks(@Req() request: FastifyRequest, @Param("jobId") jobId: string) {
    if (!this.runtime.importMediaTasks) throw new ProblemDetailsError({ status: 503, code: "IMPORT_MEDIA_UNAVAILABLE", title: "Import media tasks are unavailable" });
    return this.runtime.importMediaTasks.list(await owner(this.runtime, request), jobId);
  }

  @Post("imports/:jobId/media-tasks/:taskId/approve")
  @HttpCode(HttpStatus.ACCEPTED)
  async approveImportMediaTask(@Req() request: FastifyRequest, @Param("jobId") jobId: string, @Param("taskId") taskId: string) {
    if (!this.runtime.importMediaTasks) throw new ProblemDetailsError({ status: 503, code: "IMPORT_MEDIA_UNAVAILABLE", title: "Import media tasks are unavailable" });
    return this.runtime.importMediaTasks.approve(await owner(this.runtime, request), jobId, taskId);
  }

  @Post("imports/:jobId/media-tasks/:taskId/reject")
  @HttpCode(HttpStatus.OK)
  async rejectImportMediaTask(@Req() request: FastifyRequest, @Param("jobId") jobId: string, @Param("taskId") taskId: string, @Body() body: { reason?: string }) {
    if (!this.runtime.importMediaTasks) throw new ProblemDetailsError({ status: 503, code: "IMPORT_MEDIA_UNAVAILABLE", title: "Import media tasks are unavailable" });
    return this.runtime.importMediaTasks.reject(await owner(this.runtime, request), jobId, taskId, body);
  }

  @Post("imports/:jobId/media-tasks/:taskId/retry")
  @HttpCode(HttpStatus.ACCEPTED)
  async retryImportMediaTask(@Req() request: FastifyRequest, @Param("jobId") jobId: string, @Param("taskId") taskId: string) {
    if (!this.runtime.importMediaTasks) throw new ProblemDetailsError({ status: 503, code: "IMPORT_MEDIA_UNAVAILABLE", title: "Import media tasks are unavailable" });
    return this.runtime.importMediaTasks.retry(await owner(this.runtime, request), jobId, taskId);
  }

  @Post("imports/:jobId/media-tasks/:taskId/cancel")
  @HttpCode(HttpStatus.ACCEPTED)
  async cancelImportMediaTask(@Req() request: FastifyRequest, @Param("jobId") jobId: string, @Param("taskId") taskId: string) {
    if (!this.runtime.importMediaTasks) throw new ProblemDetailsError({ status: 503, code: "IMPORT_MEDIA_UNAVAILABLE", title: "Import media tasks are unavailable" });
    return this.runtime.importMediaTasks.cancel(await owner(this.runtime, request), jobId, taskId);
  }

  @Get("jobs/:jobId")
  async getJob(
    @Req() request: FastifyRequest,
    @Param("jobId") jobId: string,
  ) {
    if (!this.runtime.imports) {
      throw new ProblemDetailsError({
        status: 503,
        code: "IMPORT_TRANSPORT_UNAVAILABLE",
        title: "Import transport is unavailable",
      });
    }
    return this.runtime.imports.getJob({
      ownerId: await owner(this.runtime, request),
      jobId,
    });
  }
}

@Module({})
class ApiModule {}

export async function createApiApplication(
  runtime: ApiRuntime,
  options: { readonly telemetry?: ApiTelemetry } = {},
): Promise<NestFastifyApplication> {
  const module = {
    module: ApiModule,
    controllers: [HealthController, ApiController],
    providers: [{ provide: RUNTIME, useValue: runtime }],
  };
  const app = await NestFactory.create<NestFastifyApplication>(
    module,
    new FastifyAdapter({ logger: false }),
    { bufferLogs: true },
  );
  app.enableCors({
    origin: runtime.appOrigin,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  installHttpTelemetry(app, options.telemetry ?? apiTelemetry);
  app.enableShutdownHooks();
  await app.init();
  return app;
}

function installHttpTelemetry(app: NestFastifyApplication, telemetry: ApiTelemetry) {
  const requests = new WeakMap<object, {
    readonly context: ReturnType<typeof acceptRequestContext>;
    readonly startedAt: number;
  }>();
  const server = app.getHttpAdapter().getInstance();
  server.addHook("onRequest", async (request, reply) => {
    const context = acceptRequestContext({
      ...(typeof request.headers.traceparent === "string"
        ? { traceparent: request.headers.traceparent }
        : {}),
      ...(typeof request.headers["x-request-id"] === "string"
        ? { "x-request-id": request.headers["x-request-id"] }
        : {}),
    });
    requests.set(request, { context, startedAt: performance.now() });
    reply.headers(injectTraceHeaders(context));
  });
  server.addHook("onResponse", async (request, reply) => {
    const state = requests.get(request);
    if (!state) return;
    const route = request.routeOptions.url ?? "unmatched";
    const labels = {
      method: request.method,
      route,
      status_code: String(reply.statusCode),
    };
    telemetry.metric("http.server.requests", 1, labels, state.context);
    telemetry.metric(
      "http.server.duration",
      performance.now() - state.startedAt,
      labels,
      state.context,
    );
    telemetry.span("http.request.completed", {
      context: state.context,
      attributes: labels,
    });
  });
  server.addHook("onError", async (request, _reply, error) => {
    const state = requests.get(request);
    telemetry.log(
      error.statusCode && error.statusCode < 500 ? "warn" : "error",
      "http.request.failed",
      {
        route: request.routeOptions.url ?? "unmatched",
        method: request.method,
        code: error.code ?? "INTERNAL_ERROR",
      },
      state?.context,
    );
  });
}
