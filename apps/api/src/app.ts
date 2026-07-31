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

function owner(runtime: ApiRuntime, request: FastifyRequest): string {
  const token = cookie(request, "__Host-otr_session");
  if (!token) {
    throw new ProblemDetailsError({
      status: 401,
      code: "SESSION_REQUIRED",
      title: "Authentication required",
    });
  }
  return runtime.identity.authenticate(token).id;
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
  developmentSession(
    @Body() body: { subject?: string },
    @Headers("origin") origin: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = this.runtime.identity.loginWithDevelopmentIdentity({
      subject: body.subject ?? "",
      origin: origin ?? this.runtime.appOrigin,
    });
    reply.header("set-cookie", result.setCookie);
    return { principal: result.principal };
  }

  @Get("identity/session")
  session(@Req() request: FastifyRequest) {
    return { principal: this.runtime.identity.authenticate(
      cookie(request, "__Host-otr_session") ?? "",
    ) };
  }

  @Delete("identity/session")
  logout(
    @Req() request: FastifyRequest,
    @Headers("origin") origin: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = this.runtime.identity.logout({
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
    const trip = await this.runtime.trips.createTrip(owner(this.runtime, request), body, {
      idempotencyKey,
    });
    reply.status(HttpStatus.CREATED).header("etag", String(trip.version));
    return trip;
  }

  @Get("trips")
  listTrips(
    @Req() request: FastifyRequest,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.runtime.trips.listTrips(owner(this.runtime, request), {
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
    const trip = await this.runtime.trips.getTrip(owner(this.runtime, request), tripId);
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
      owner(this.runtime, request),
      tripId,
      body,
      { expectedVersion: version(ifMatch) },
    );
    reply.header("etag", String(trip.version));
    return trip;
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
      owner(this.runtime, request),
      tripId,
      { ...body, tripDayId },
    );
    const versioned = item as typeof item & { version: number };
    reply.status(HttpStatus.CREATED).header("etag", String(versioned.version));
    return item;
  }

  @Get("trips/:tripId/days/:tripDayId/itinerary-items")
  listItems(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
    @Param("tripDayId") tripDayId: string,
  ) {
    return this.runtime.itinerary.listDay(
      owner(this.runtime, request),
      tripId,
      tripDayId,
    );
  }

  @Post("trips/:tripId/locations")
  createLocation(
    @Req() request: FastifyRequest,
    @Param("tripId") tripId: string,
    @Body() body: { inputText: string; name?: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.status(HttpStatus.CREATED);
    return this.runtime.locations.create(owner(this.runtime, request), tripId, body);
  }

  @Get("trips/:tripId/locations/search")
  searchLocations(
    @Req() request: FastifyRequest,
    @Query("q") query: string,
    @Query("limit") limit?: string,
  ) {
    owner(this.runtime, request);
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
      owner(this.runtime, request),
      locationId,
      version(ifMatch),
      { latitude: body.latitude, longitude: body.longitude, crs: "WGS84" },
      body.formattedAddress ? { formattedAddress: body.formattedAddress } : {},
    );
    reply.header("etag", String(location.version));
    return location;
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
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  await app.init();
  return app;
}
