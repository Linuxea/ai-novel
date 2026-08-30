import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import {
  getProjectsApplication,
  ProjectApiVersionRequestSchema,
} from "@/modules/projects";
import {
  parseProjectId,
  parseProjectJson,
  projectResultResponse,
  projectRouteError,
} from "../../http";

interface RouteContext {
  readonly params: Promise<{ readonly projectId: string }>;
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    const { projectId: rawProjectId } = await context.params;
    const projectId = parseProjectId(rawProjectId);
    const input = await parseProjectJson(
      request,
      ProjectApiVersionRequestSchema,
    );
    return projectResultResponse(
      getProjectsApplication().restoreProject(
        {
          expectedVersion: input.expectedVersion,
          projectId,
        },
        { correlationId: randomUUID() },
      ),
    );
  } catch (error) {
    return projectRouteError(error);
  }
}
