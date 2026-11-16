import { Global, Module } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { SessionService } from "../auth/session.service";
import { CopernicusDemClient } from "../gateway/copernicus-dem.client";
import { ProjectsService } from "../projects/projects.service";
import { GeodataController } from "./geodata.controller";
import { GeodataReader } from "./geodata-reader";
import { GeodataService } from "./geodata.service";
import { ProjectGate } from "./project-gate";

/**
 * OpenStreetMap and elevation imported per project area (06-gis §2 and §4, ADR-0045), and the readers the
 * street-network and terrain services use when a project has an import. Global, so those modules take the
 * readers as optional dependencies: assembled without this module (as some tests do), they serve live data only.
 */
@Global()
@Module({
  controllers: [GeodataController],
  providers: [
    AuditService,
    ProjectsService,
    SessionService,
    GeodataService,
    ProjectGate,
    GeodataReader,
    { provide: CopernicusDemClient, useFactory: () => new CopernicusDemClient() },
  ],
  exports: [GeodataService, GeodataReader, ProjectGate, ProjectsService],
})
export class GeodataModule {}
