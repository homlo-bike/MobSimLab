import { Module } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { GbfsClient } from "../gateway/gbfs.client";
import { ProjectsService } from "../projects/projects.service";
import { StreetNetworkModule } from "../street-network/street-network.module";
import { RunQueue } from "./queue";
import { RunsService } from "./runs.service";

/**
 * Simulation runs on the background worker (ADR-0023). One module, so the planners' API and the agent tools
 * (ADR-0035 §7) share one pg-boss client.
 */
@Module({
  imports: [StreetNetworkModule],
  providers: [
    AuditService,
    ProjectsService,
    RunQueue,
    RunsService,
    { provide: GbfsClient, useFactory: () => new GbfsClient() },
  ],
  exports: [ProjectsService, RunsService],
})
export class SimulationModule {}
