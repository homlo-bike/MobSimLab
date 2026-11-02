import { SetMetadata } from "@nestjs/common";
import type { Action } from "./policy";

export const REQUIRES_KEY = "mobsimlab:requires";
export const PUBLIC_KEY = "mobsimlab:public";

/** Purpose: declare the action a route needs. The global guard enforces it. */
export const Requires = (action: Action): MethodDecorator => SetMetadata(REQUIRES_KEY, action);

/** Purpose: mark a route as reachable without a session (health, sign-in). Use sparingly. */
export const Public = (): MethodDecorator => SetMetadata(PUBLIC_KEY, true);

export const CROSS_ORIGIN_KEY = "mobsimlab:cross-origin";
export const BEARER_KEY = "mobsimlab:bearer";

/**
 * Purpose: a public route that machines call from other origins without cookies (OAuth token, registration and
 * revocation endpoints). The session cookie is ignored and the same-origin check is skipped.
 */
export const CrossOrigin = (): MethodDecorator & ClassDecorator => SetMetadata(CROSS_ORIGIN_KEY, true);

/**
 * Purpose: a route authenticated by an agent bearer token instead of the session cookie (`/mcp`). The global
 * guard ignores cookies and the same-origin check; the route's own guard checks the token.
 */
export const BearerAuth = (): MethodDecorator & ClassDecorator => SetMetadata(BEARER_KEY, true);
