import { Module } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { SimulationModule } from "../simulation/simulation.module";
import { ToolRunner } from "../tool-runner/runner";
import { PluginCodeService } from "./code/code.service";
import { PluginsService } from "./plugins.service";

/** Plugins (ADR-0036): install, enable per project, and their code (served to browsers, run in the sandbox). */
@Module({
  imports: [SimulationModule],
  providers: [AuditService, PluginsService, PluginCodeService, ToolRunner],
  exports: [PluginsService, PluginCodeService],
})
export class PluginsModule {}
