import { SetMetadata } from "@nestjs/common";
import type { Action } from "./policy";

export const REQUIRES_KEY = "mobsimlab:requires";
export const PUBLIC_KEY = "mobsimlab:public";

/** Purpose: declare the action a route needs. The global guard enforces it. */
export const Requires = (action: Action): MethodDecorator => SetMetadata(REQUIRES_KEY, action);

/** Purpose: mark a route as reachable without a session (health, sign-in). Use sparingly. */
export const Public = (): MethodDecorator => SetMetadata(PUBLIC_KEY, true);
