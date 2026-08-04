import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getProject,
  DomainValidationError,
  NotFoundError,
  RevisionConflictError,
} from "@/lib/storage";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export async function parseJson<T>(
  req: NextRequest,
  schema: z.ZodType<T>,
): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError("请求 JSON 无效", 400);
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError(formatZodError(result.error), 400);
  }
  return result.data;
}

export async function requireProject(projectId: string) {
  const project = await getProject(projectId);
  if (!project) throw new ApiError("项目不存在", 404);
  return project;
}

export function handleRouteError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof RevisionConflictError) {
    return NextResponse.json(
      {
        error: error.message,
        code: "REVISION_CONFLICT",
        expectedRevision: error.expectedRevision,
        actualRevision: error.actualRevision,
      },
      { status: 409 },
    );
  }
  if (error instanceof DomainValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: formatZodError(error) },
      { status: 400 },
    );
  }
  return NextResponse.json(
    { error: (error as Error).message || "服务器错误" },
    { status: 500 },
  );
}

function formatZodError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "请求参数无效";
  const path = issue.path.length ? issue.path.join(".") : "body";
  return `${path}: ${issue.message}`;
}
