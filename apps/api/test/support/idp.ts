import type { NestExpressApplication } from "@nestjs/platform-express";
import { OAuth2Server } from "oauth2-mock-server";
import request from "supertest";

/** A mock OIDC provider whose ID tokens carry claims chosen per sign-in. */
export interface TestIdp {
  server: OAuth2Server;
  issuer: URL;
  /** nonce -> claims to put in the ID token for that login. */
  claims: Map<string, Record<string, unknown>>;
}

/** Purpose: start a mock provider on a random local port. */
export async function startIdp(): Promise<TestIdp> {
  const server = new OAuth2Server();
  await server.issuer.keys.generate("RS256");
  await server.start(0, "127.0.0.1");
  const claims = new Map<string, Record<string, unknown>>();
  server.service.on("beforeTokenSigning", (token: { payload: Record<string, unknown> }) => {
    const c = claims.get(String(token.payload.nonce));
    if (c) Object.assign(token.payload, c);
  });
  return { server, issuer: new URL(String(server.issuer.url)), claims };
}

/** Purpose: read one cookie value from a response's Set-Cookie headers. */
export function cookieValue(res: request.Response, name: string): string | undefined {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  const c = raw?.find((s) => s.startsWith(`${name}=`));
  return c ? decodeURIComponent(c.slice(name.length + 1).split(";")[0] ?? "") : undefined;
}

/**
 * Purpose: run the whole browser sign-in flow for one user.
 * Inputs: app, provider, subject and extra ID-token claims (e.g. `groups`). Output: the callback response,
 * or the first refused response when the login start is refused (e.g. 429).
 */
export async function signIn(
  app: NestExpressApplication,
  idp: TestIdp,
  sub: string,
  extra: Record<string, unknown> = {},
): Promise<request.Response> {
  const start = await request(app.getHttpServer()).get("/api/auth/login");
  if (start.status !== 302) return start;
  const authorize = new URL(start.headers.location as string);
  idp.claims.set(authorize.searchParams.get("nonce") ?? "", {
    sub,
    email: `${sub}@example.org`,
    email_verified: true,
    name: sub,
    ...extra,
  });
  const flow = cookieValue(start, "msl_auth_flow");
  const idpRes = await fetch(authorize, { redirect: "manual" });
  const back = new URL(idpRes.headers.get("location") ?? "");
  return request(app.getHttpServer())
    .get(`${back.pathname}${back.search}`)
    .set("Cookie", `msl_auth_flow=${flow}`);
}
