// F-38: one log line and two metrics per HTTP request. The Fastify server arrives with S-4; this
// takes the small part of FastifyInstance it uses.
import type { Logger } from "./logger.js";
import type { PlatformMetrics } from "./metrics.js";

export interface RequestLogRequest {
  method: string;
  url: string;
  routeOptions?: { url?: string };
  orpcRoute?: string;
  requestId?: string;
  userId?: string;
  clientKind?: string;
  clientVersion?: number | null;
}

export interface RequestLogReply {
  statusCode: number;
  elapsedTime: number;
}

export interface RequestLogApp {
  addHook(
    name: "onResponse",
    hook: (request: RequestLogRequest, reply: RequestLogReply) => Promise<void>,
  ): unknown;
}

export function registerRequestLog(
  app: RequestLogApp,
  deps: { logger: Logger; metrics: PlatformMetrics },
): void {
  app.addHook("onResponse", (request, reply) => {
    const route = request.orpcRoute ?? request.routeOptions?.url ?? "unmatched";
    const status = reply.statusCode;
    const statusClass = `${String(Math.floor(status / 100))}xx`;
    const clientKind = request.clientKind ?? "other";
    const fields = {
      method: request.method,
      route,
      status,
      statusClass,
      durationMs: reply.elapsedTime,
      clientKind,
      ...(request.clientVersion === null || request.clientVersion === undefined
        ? {}
        : { clientVersion: request.clientVersion }),
      ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
      ...(request.userId === undefined ? {} : { userId: request.userId }),
    };
    if (route === "/health/live" || route === "/health/ready") {
      deps.logger.debug("http_request", fields);
    } else {
      deps.logger.info("http_request", fields);
    }
    deps.metrics.httpServerRequests.add(1, {
      http_route: route,
      method: request.method,
      status_class: statusClass,
      client_kind: clientKind,
    });
    deps.metrics.httpServerDuration.record(reply.elapsedTime / 1000, {
      http_route: route,
      method: request.method,
    });
    return Promise.resolve();
  });
}
