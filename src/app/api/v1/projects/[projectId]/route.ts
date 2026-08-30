import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import {
  getProjectsApplication,
  ProjectApiPatchRequestSchema,
} from "@/modules/projects";
import {
  parseProjectId,
  parseProjectJson,
  projectResultResponse,
  projectRouteError,
} from "../http";

interface RouteContext {
  readonly params: Promise<{ readonly projectId: string }>;
}

export async function GET(
  _request: NextRequest,
  context: RouteContext,
) {
  try {
    const { projectId: rawProjectId } = await context.params;
    const projectId = parseProjectId(rawProjectId);
    return projectResultResponse(
      getProjectsApplication().getProject(projectId),
    );
  } catch (error) {
    return projectRouteError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    const { projectId: rawProjectId } = await context.params;
    const projectId = parseProjectId(rawProjectId);
    const input = await parseProjectJson(
      request,
      ProjectApiPatchRequestSchema,
    );
    const application = getProjectsApplication();
    const commandContext = { correlationId: randomUUID() };
    const result =
      input.action === "update"
        ? application.updateProject(
            {
              expectedVersion: input.expectedVersion,
              patch: input.patch,
              projectId,
            },
            commandContext,
          )
        : application.transitionProject(
            {
              expectedVersion: input.expectedVersion,
              projectId,
              status: input.status,
            },
            commandContext,
          );
    return projectResultResponse(result);
  } catch (error) {
    return projectRouteError(error);
  }
}
