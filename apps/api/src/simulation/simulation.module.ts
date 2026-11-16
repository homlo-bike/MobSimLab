import { Module } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { ProjectsService } from "../projects/projects.service";
import { RunQueue } from "./queue";
import { RunsService } from "./runs.service";

/**
 * Simulation runs on the background worker (ADR-0023). One module, so the planners' API and the agent tools
 * (ADR-0035 §7) share one pg-boss client.
 */
@Module({
  providers: [AuditService, ProjectsService, RunQueue, RunsService],
  exports: [ProjectsService, RunsService],
})
export class SimulationModule {}
