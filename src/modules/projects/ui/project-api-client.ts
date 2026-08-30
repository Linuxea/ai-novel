import { z } from "zod";
import {
  ProjectApiErrorResponseSchema,
  ProjectDetailResponseSchema,
  ProjectListResponseSchema,
} from "./api-contracts";

export class ProjectApiClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ProjectApiClientError";
  }
}

async function responseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ProjectApiClientError(
      "服务器返回了无法读取的响应",
      "projects.invalid_response",
      response.status,
    );
  }
}

async function parseResponse<TSchema extends z.ZodType>(
  response: Response,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  const body = await responseBody(response);
  if (!response.ok) {
    const parsedError = ProjectApiErrorResponseSchema.safeParse(body);
    throw new ProjectApiClientError(
      parsedError.success
        ? parsedError.data.error.message
        : "作品操作未能完成",
      parsedError.success
        ? parsedError.data.error.code
        : "projects.request_failed",
      response.status,
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ProjectApiClientError(
      "服务器返回的作品数据不符合约定",
      "projects.invalid_response",
      response.status,
    );
  }
  return parsed.data;
}

export async function fetchProjectList(
  query: Readonly<Record<string, string>>,
) {
  const parameters = new URLSearchParams(query);
  const response = await fetch(`/api/v1/projects?${parameters.toString()}`);
  return parseResponse(response, ProjectListResponseSchema);
}

export async function fetchProjectRequest(projectId: string) {
  const response = await fetch(`/api/v1/projects/${projectId}`);
  return (await parseResponse(response, ProjectDetailResponseSchema)).data;
}

export async function createProjectRequest(input: unknown) {
  const response = await fetch("/api/v1/projects", {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  return (await parseResponse(response, ProjectDetailResponseSchema)).data;
}

export async function updateProjectRequest(
  projectId: string,
  input: unknown,
) {
  const response = await fetch(`/api/v1/projects/${projectId}`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
  return (await parseResponse(response, ProjectDetailResponseSchema)).data;
}

export async function archiveProjectRequest(
  projectId: string,
  expectedVersion: number,
) {
  const response = await fetch(
    `/api/v1/projects/${projectId}/archive`,
    {
      body: JSON.stringify({ expectedVersion }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  return (await parseResponse(response, ProjectDetailResponseSchema)).data;
}

export async function restoreProjectRequest(
  projectId: string,
  expectedVersion: number,
) {
  const response = await fetch(
    `/api/v1/projects/${projectId}/restore`,
    {
      body: JSON.stringify({ expectedVersion }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  return (await parseResponse(response, ProjectDetailResponseSchema)).data;
}
