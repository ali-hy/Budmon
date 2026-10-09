// F-55: the API server.
import path from "node:path";
import cookie from "@fastify/cookie";
import { API_VERSION } from "@budmon/contract";
import type { AnyContractRouter } from "@orpc/contract";
import { JsonSchemaCoercer, type JsonSchema } from "@orpc/json-schema";
import { OpenAPIHandler } from "@orpc/openapi/fastify";
import type { Router } from "@orpc/server";
import { RequestHeadersPlugin, ResponseHeadersPlugin } from "@orpc/server/plugins";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { trace } from "@opentelemetry/api";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { serverRoot } from "../config/serverRoot.js";
import type { ApiContainer } from "../container.js";
import { readJournal } from "../db/migrations.js";
import { createCommitTracker } from "../db/transaction.js";
import { createErrorInterceptor } from "../errors/interceptor.js";
import { registerRequestLog, type RequestLogRequest } from "../observability/requestLog.js";
import { registerBodyHandling, registerSecurityHeaders, BODY_LIMIT } from "../security/headers.js";
import { appRouter } from "./appRouter.js";
import { clientVersionMiddleware, parseClientHeader } from "./clientVersion.js";
import type { RequestContext } from "./context.js";
import { registerHealthRoutes } from "./health.js";

const PREFIX = "/api/v1";
const NOT_FOUND = { defined: true, code: "NOT_FOUND", status: 404, message: "Not found" };

declare module "fastify" {
  interface FastifyRequest {
    budmon: RequestContext | null;
    orpcRoute: string | undefined;
  }
}

function requestId(ids: ApiContainer["ids"]): string {
  const span = trace.getActiveSpan()?.spanContext();
  if (span !== undefined && /^[0-9a-f]{32}$/.test(span.traceId) && !/^0+$/.test(span.traceId)) {
    return span.traceId;
  }
  return ids.next().replaceAll("-", "");
}

/** A-168: the matched route is the oRPC catch-all or a module route under /api/v1/. */
function isApiRoute(request: FastifyRequest): boolean {
  return request.routeOptions.url?.startsWith(`${PREFIX}/`) === true;
}

function lowerCaseHeaders(request: FastifyRequest): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    out[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

export async function createApiServer(
  c: ApiContainer,
  opts: {
    contract?: AnyContractRouter;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- oRPC's own Router type takes any contract
    router?: Router<any, RequestContext>;
    journal?: readonly { hash: string; when: number }[];
  } = {},
): Promise<FastifyInstance> {
  const api = c.config.api;
  const trustedProxy = api?.trustedProxy ?? [];
  // 1.
  const app = Fastify({
    logger: false,
    trustProxy: trustedProxy.length > 0 ? trustedProxy : false,
    bodyLimit: BODY_LIMIT,
    connectionTimeout: 30000,
    requestTimeout: 30000,
    return503OnClosing: true,
    genReqId: () => requestId(c.ids),
  });
  app.decorateRequest("budmon", null);
  app.decorateRequest("orpcRoute", undefined);

  // 2. Headers, body handling (A-124), the coarse rate limit once S-5 provides it, cookies.
  await registerSecurityHeaders(app);
  registerBodyHandling(app, { reporter: c.reporter, logger: c.logger });
  await app.register(cookie);

  // 3. The request context.
  app.addHook("onRequest", async (request) => {
    const headers = lowerCaseHeaders(request);
    const client = parseClientHeader(headers["x-budmon-client"]);
    // A-154, A-168: only routes under /api/v1/ are authenticated, keyed on the matched route (so
    // a percent-encoded path is treated like its decoded match); others get no principal.
    const principal = isApiRoute(request)
      ? await c.authHook.authenticate({
          headers,
          cookies: request.cookies as Record<string, string>,
        })
      : null;
    const resHeaders = new Headers();
    request.budmon = {
      requestId: request.id,
      principal,
      clientKind: client.kind,
      clientVersion: client.version,
      ip: request.ip,
      method: request.method,
      headers,
      responseHeaders: resHeaders,
      resHeaders,
      commitTracker: createCommitTracker(),
      logger: c.logger.child({ requestId: request.id }),
      container: c,
      matched: {},
    };
  });

  // 4. Health.
  registerHealthRoutes(app, {
    db: c.database,
    appEnv: c.config.appEnv,
    journal: opts.journal ?? readJournal(path.join(serverRoot(), "drizzle")),
  });

  // 4b. Module routes (A-26), before the catch-all.
  for (const register of c.moduleRoutes) register(app);

  // 5. oRPC.
  const errors = createErrorInterceptor({ reporter: c.reporter, logger: c.logger });
  const versions = clientVersionMiddleware(
    api?.clientVersions ?? { minAndroid: 0, latestAndroid: 0, minWeb: 0 },
    c.metrics,
  );
  // A-148, A-165, A-173: query and path strings become the integer, boolean or date the input schema
  // declares, only for methods without a body; JSON bodies are never coerced.
  const converter = new ZodToJsonSchemaConverter();
  const coercer = new JsonSchemaCoercer();
  const inputJsonSchemas = new WeakMap<object, JsonSchema>();
  const coerceInput = (options: {
    procedure: { "~orpc": { inputSchema?: unknown } };
    input: unknown;
    context: RequestContext;
  }): unknown => {
    const schema = options.procedure["~orpc"].inputSchema;
    const method = options.context.method;
    if (typeof schema !== "object" || schema === null || (method !== "GET" && method !== "HEAD")) {
      return options.input;
    }
    let json = inputJsonSchemas.get(schema);
    if (json === undefined) {
      json = converter.convert(schema as Parameters<typeof converter.convert>[0], {
        strategy: "input",
      })[1];
      inputJsonSchemas.set(schema, json);
    }
    return coercer.coerce(json, options.input);
  };
  const handler = new OpenAPIHandler<RequestContext>(opts.router ?? appRouter, {
    plugins: [
      new ResponseHeadersPlugin<RequestContext>(),
      new RequestHeadersPlugin<RequestContext>(),
    ],
    clientInterceptors: [
      (options) => {
        const procedureRoute = options.procedure["~orpc"].route.path;
        if (procedureRoute !== undefined) options.context.matched.route = procedureRoute;
        return errors({
          next: () =>
            versions({
              next: () => options.next({ ...options, input: coerceInput(options) }),
              path: options.path,
              context: options.context,
            }),
          context: options.context,
          path: options.path,
          errorMap: options.procedure["~orpc"].errorMap,
          ...(procedureRoute === undefined ? {} : { route: procedureRoute }),
        });
      },
    ],
  });
  app.all(`${PREFIX}/*`, async (request, reply) => {
    const context = request.budmon;
    if (context === null) return reply.code(404).send(NOT_FOUND);
    const result = await handler.handle(request, reply, { prefix: PREFIX, context });
    request.orpcRoute = context.matched.route ?? "/unmatched";
    if (!result.matched) return reply.code(404).send(NOT_FOUND);
    return reply;
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send(NOT_FOUND));

  // 7. The request log.
  registerRequestLog(
    {
      addHook: (name, hook) =>
        app.addHook(name, async (request, reply) => {
          const context = request.budmon;
          const orpcRoute = context?.matched.route ?? request.orpcRoute;
          const logged: RequestLogRequest = {
            method: request.method,
            url: request.url,
            routeOptions: {
              // The oRPC catch-all's own pattern isn't a route: a request refused before oRPC
              // matched (a body error) is logged as /unmatched.
              ...(request.routeOptions.url === undefined || request.routeOptions.url.includes("*")
                ? {}
                : { url: request.routeOptions.url }),
            },
            ...(orpcRoute === undefined ? {} : { orpcRoute }),
            requestId: request.id,
            ...(context?.principal?.userId === undefined
              ? {}
              : { userId: context.principal.userId }),
            ...(context === null
              ? {}
              : { clientKind: context.clientKind, clientVersion: context.clientVersion }),
          };
          await hook(logged, { statusCode: reply.statusCode, elapsedTime: reply.elapsedTime });
        }),
    },
    { logger: c.logger, metrics: c.metrics },
  );

  // 8. Response headers.
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    if (isApiRoute(request)) reply.header("x-budmon-api-version", API_VERSION);
    return payload;
  });

  // CORS isn't registered; OPTIONS on /api/v1/* is the 404 envelope (D-36).
  return app;
}
