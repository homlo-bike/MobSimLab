import { Module } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { BenefitsModule } from "../benefits/benefits.module";
import { GhslClient } from "../gateway/ghsl.client";
import { ProjectsService } from "../projects/projects.service";
import { PopulationLayersService } from "./layers.service";
import { PopulationModule } from "./population.module";

/**
 * Population layers of a project (06-gis §3): WorldPop and GHSL imports for the project area, the planners'
 * own files, the primary layer and the difference layer. PopulationLayersController is registered with the
 * app's controllers, next to the session service it needs.
 */
@Module({
  imports: [PopulationModule, BenefitsModule],
  providers: [
    PopulationLayersService,
    AuditService,
    ProjectsService,
    { provide: GhslClient, useFactory: () => new GhslClient() },
  ],
  exports: [PopulationLayersService, PopulationModule, BenefitsModule],
})
export class PopulationLayersModule {}
