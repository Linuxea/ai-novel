import type { ReactNode } from "react";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import HomePage from "@/app/page";
import StudioPage from "@/app/studio/[projectId]/page";
import { getProjectsApplication } from "@/modules/projects";
import { closeDatabaseSingleton } from "@/platform/database";

vi.mock("next/navigation", async (importOriginal) => {
  const original = await importOriginal<typeof import("next/navigation")>();
  return {
    ...original,
    useRouter: () => ({
      push: vi.fn(),
      refresh: vi.fn(),
    }),
  };
});

const directory = mkdtempSync(join(tmpdir(), "ai-novel-projects-rsc-"));
const databasePath = join(directory, "rsc.sqlite");
let projectId = "";

function wrapper({ children }: { readonly children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

beforeAll(() => {
  process.env.DATABASE_PATH = databasePath;
  closeDatabaseSingleton();
  const created = getProjectsApplication().createProject(
    {
      genre: "悬疑",
      premise: "失忆校对员发现错字可以改写现实。",
      targetAudience: "成年类型文学读者",
      targetWordCount: 180_000,
      title: "纸上迷城",
    },
    { correlationId: "rsc-create" },
  );
  if (!created.ok) {
    throw new Error(created.error.message);
  }
  projectId = created.value.id;
});

afterAll(() => {
  closeDatabaseSingleton();
  delete process.env.DATABASE_PATH;
  rmSync(directory, { force: true, recursive: true });
});

describe("项目 RSC 首屏", () => {
  it("根 RSC 从 SQLite 查询首屏作品而非旧文件 store", async () => {
    render(await HomePage(), { wrapper });

    expect(
      screen.getByRole("heading", { name: "作品台" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "纸上迷城" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "打开《纸上迷城》工作台" }),
    ).toHaveAttribute("href", `/studio/${projectId}`);
  });

  it("新工作台 RSC 直接读取 SQLite 项目", async () => {
    render(
      await StudioPage({
        params: Promise.resolve({ projectId }),
      }),
      { wrapper },
    );

    expect(
      screen.getByRole("heading", { name: "纸上迷城" }),
    ).toBeInTheDocument();
    expect(screen.getByText("故事核心")).toBeInTheDocument();
  });
});
