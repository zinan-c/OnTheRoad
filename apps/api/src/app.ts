import { randomUUID } from "node:crypto";

import {
  Body,
  Controller,
  Delete,
  ExceptionFilter,
  Catch,
  Get,
  Headers,
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

import { toProblemDetails, ProblemDetailsError } from "./common/problem-details/index.mjs";
import type { ApiRuntime } from "./runtime.js";

const RUNTIME = Symbol("API_RUNTIME");

function cookie(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers.cookie
    ?.split(";")
    .map((entry) => entry.trim().split("="))
    .find(([key]) => key === name)?.[1];
  return value ? decodeURIComponent(value) : undefined;
}

async function owner(runtime: ApiRuntime, request: FastifyRequest): Promise<string> {
  const token = cookie(request, "__Host-otr_session");
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
      transactionCookie: cookie(request, "__Host-otr_oidc") ?? "",
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
      cookie(request, "__Host-otr_session") ?? "",
    ) };
  }

  @Delete("identity/session")
  async logout(
    @Req() request: FastifyRequest,
    @Headers("origin") origin: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.runtime.identity.logout({
      token: cookie(request, "__Host-otr_session") ?? "",
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
      directions: false,
      staticMaps: false,
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
    const result = await this.runtime.tripDates.apply(
      await owner(this.runtime, request),
      tripId,
      {
        startDate: body.startDate,
        endDate: body.endDate,
        expectedVersion: version(ifMatch),
        confirmDestructive: body.removedDayPolicy === "confirm_remove",
      },
    );
    const resultVersion = (result as { version?: number }).version;
    if (resultVersion) reply.header("etag", String(resultVersion));
    return result;
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
    @Query("q") query: string,
    @Query("limit") limit?: string,
  ) {
    await owner(this.runtime, request);
    return this.runtime.locationSearch.search({
      query,
      ...(limit ? { limit: Number(limit) } : {}),
      trigger: "explicit",
    });
  }

  @Patch("trips/:tripId/locations/:locationId/coordinates")
  async adjustCoordinates(
    @Req() request: FastifyRequest,
    @Param("locationId") locationId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: { latitude: number; longitude: number; formattedAddress?: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const location = await this.runtime.locations.manuallyAdjust(
      await owner(this.runtime, request),
      locationId,
      version(ifMatch),
      { latitude: body.latitude, longitude: body.longitude, crs: "WGS84" },
      body.formattedAddress ? { formattedAddress: body.formattedAddress } : {},
    );
    reply.header("etag", String(location.version));
    return location;
  }

  @Post("trips/:tripId/locations/:locationId/candidate")
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
    @Body() body: {
      contentType: string;
      contentLength: number;
      checksumSha256: string;
    },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const session = await this.runtime.attachments.createSession({
      ownerId: await owner(this.runtime, request),
      contentType: body.contentType,
      contentLength: body.contentLength,
      checksumSha256: body.checksumSha256,
    });
    reply.status(HttpStatus.CREATED);
    return session;
  }

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

export async function createApiApplication(runtime: ApiRuntime): Promise<NestFastifyApplication> {
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
  app.enableShutdownHooks();
  await app.init();
  return app;
}
