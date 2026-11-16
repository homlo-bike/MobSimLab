import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { z } from "zod";
import type { MslRequest } from "../auth/session.service";
import { ProjectsService } from "../projects/projects.service";

const uuid = z.uuid();
const TTL_MS = 60_000;

/**
 * Checks that the caller may read a project before a shared endpoint (street tiles, terrain) answers from the
 * project's imported data. Positive answers are remembered for a minute per person and project, because a map
 * asks for many tiles at once. A project the caller cannot read is a 404, as everywhere else.
 */
@Injectable()
export class ProjectGate {
  private readonly ok = new Map<string, number>();

  constructor(private readonly projects: ProjectsService) {}

  /**
   * Purpose: the project ID from a `project` parameter after checking read access; undefined when absent.
   * Throws 400 for a malformed ID, 404 when the caller cannot read the project.
   */
  async readable(req: MslRequest, project: unknown): Promise<string | undefined> {
    if (project === undefined || project === null || project === "") return undefined;
    const r = uuid.safeParse(project);
    if (!r.success) throw new BadRequestException("project must be a project ID");
    const s = req.session;
    if (!s) throw new ForbiddenException();
    const key = `${s.actor.userId}/${r.data}`;
    const until = this.ok.get(key);
    if (until && until > Date.now()) return r.data;
    await this.projects.access(
      { userId: s.actor.userId, role: s.actor.role, ipHash: null, requestId: req.requestId ?? null },
      r.data,
      "read",
    );
    if (this.ok.size > 10_000) this.ok.clear();
    this.ok.set(key, Date.now() + TTL_MS);
    return r.data;
  }
}
