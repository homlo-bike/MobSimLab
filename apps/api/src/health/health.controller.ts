import { Controller, Get } from "@nestjs/common";
import { Public } from "../iam/requires";

/** Liveness endpoint used by the container health check. Public, returns no internal details. */
@Controller("api/health")
export class HealthController {
  /** Purpose: report that the API process is up. Output: `{ status: "ok" }`. */
  @Get()
  @Public()
  get(): { status: "ok" } {
    return { status: "ok" };
  }
}
