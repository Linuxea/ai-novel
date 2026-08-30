import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ProjectApiErrorResponseSchema,
  ProjectDetailResponseSchema,
  ProjectIdSchema,
  ProjectListResponseSchema,
  type NovelProject,
  type ProjectApplicationResult,
  type ProjectPage,
} from "@/modules/projects";
import { createLogger } from "@/platform/observability";

const logger = createLogger();

class ProjectRequestError extends Error {
  constructor(
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "ProjectRequestError";
  }
}

function errorStatus(kind: string): number {
  switch (kind) {
    case "validation":
      return 422;
    case "not_found":
      return 404;
    case "conflict":
      return 409;
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "unavailable":
      return 503;
    default:
      return 500;
  }
}

function requestErrorResponse(
  message: string,
  details?: Readonly<Record<string, unknown>>,
): NextResponse {
  const body = ProjectApiErrorResponseSchema.parse({
    error: {
      code: "projects.invalid_request",
      details,
      kind: "validation",
      message,
      retryable: false,
    },
  });
  return NextResponse.json(body, { status: 400 });
}

export async function parseProjectJson<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new ProjectRequestError("请求正文必须是有效 JSON");
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ProjectRequestError("请求参数不符合要求", {
      issues: parsed.error.issues.map((issue) => ({
        message: issue.message,
        path: issue.path.map(String),
      })),
    });
  }
  return parsed.data;
}

export function parseProjectListQuery(request: Request) {
  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());
  return query;
}

export function parseProjectId(value: string): string {
  return ProjectIdSchema.parse(value);
}

export function projectResultResponse(
  result: ProjectApplicationResult<NovelProject>,
  successStatus = 200,
): NextResponse {
  if (result.ok) {
    const body = ProjectDetailResponseSchema.parse({ data: result.value });
    return NextResponse.json(body, { status: successStatus });
  }
  const body = ProjectApiErrorResponseSchema.parse({
    error: result.error,
  });
  return NextResponse.json(body, {
    status: errorStatus(result.error.kind),
  });
}

export function projectListResultResponse(
  result: ProjectApplicationResult<ProjectPage>,
): NextResponse {
  if (result.ok) {
    const body = ProjectListResponseSchema.parse({
      data: result.value.items,
      pagination: {
        page: result.value.page,
        pageSize: result.value.pageSize,
        total: result.value.total,
        totalPages: result.value.totalPages,
      },
    });
    return NextResponse.json(body);
  }
  const body = ProjectApiErrorResponseSchema.parse({
    error: result.error,
  });
  return NextResponse.json(body, {
    status: errorStatus(result.error.kind),
  });
}

export function projectRouteError(error: unknown): NextResponse {
  if (error instanceof ProjectRequestError) {
    return requestErrorResponse(error.message, error.details);
  }
  if (error instanceof z.ZodError) {
    return requestErrorResponse("查询参数不符合要求", {
      issues: error.issues.map((issue) => ({
        message: issue.message,
        path: issue.path.map(String),
      })),
    });
  }
  const causeId = randomUUID();
  logger.error("项目 API 请求失败", { causeId, error });
  return projectResultResponse({
    error: {
      causeId,
      code: "projects.internal",
      kind: "internal",
      message: "作品操作暂时无法完成",
      retryable: false,
    },
    ok: false,
  });
}
