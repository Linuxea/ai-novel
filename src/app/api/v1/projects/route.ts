import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import {
  getProjectsApplication,
  ProjectApiListQuerySchema,
  ProjectCreateRequestSchema,
} from "@/modules/projects";
import {
  parseProjectJson,
  parseProjectListQuery,
  projectListResultResponse,
  projectResultResponse,
  projectRouteError,
} from "./http";

export async function GET(request: NextRequest) {
  try {
    const query = ProjectApiListQuerySchema.parse(
      parseProjectListQuery(request),
    );
    return projectListResultResponse(
      getProjectsApplication().listProjects(query),
    );
  } catch (error) {
    return projectRouteError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const input = await parseProjectJson(
      request,
      ProjectCreateRequestSchema,
    );
    return projectResultResponse(
      getProjectsApplication().createProject(input, {
        correlationId: randomUUID(),
      }),
      201,
    );
  } catch (error) {
    return projectRouteError(error);
  }
}
