import type { ReactNode } from "react";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProjectStudio,
  type NovelProject,
} from "@/modules/projects";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

const initialProject: NovelProject = {
  archivedFromStatus: null,
  createdAt: "2026-08-31T06:00:00.000Z",
  genre: "悬疑",
  id: "018f47a2-9000-7f11-8d24-4a1cc5e6d731",
  modelPreferences: {
    chat: null,
    embedding: null,
    review: null,
    writing: null,
  },
  premise: "失忆校对员发现错字可以改写现实。",
  projectSequence: 1,
  status: "planning",
  subtitle: null,
  targetAudience: "成年类型文学读者",
  targetWordCount: 180_000,
  title: "纸上迷城",
  updatedAt: "2026-08-31T06:00:00.000Z",
  version: 1,
};

function nextProject(
  changes: Partial<NovelProject>,
): NovelProject {
  return { ...initialProject, ...changes };
}

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
}

function apiErrorResponse(message: string, status = 409): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: "projects.version_conflict",
        kind: "conflict",
        message,
        retryable: false,
      },
    }),
    {
      headers: { "content-type": "application/json" },
      status,
    },
  );
}

function wrapper({ children }: { readonly children: ReactNode }) {
  const queryClient = createTestQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

beforeEach(() => {
  router.refresh.mockReset();
  vi.restoreAllMocks();
});

describe("新作品工作台", () => {
  it("编辑、归档和恢复始终携带最新 expectedVersion", async () => {
    const user = userEvent.setup();
    const updated = nextProject({
      projectSequence: 2,
      title: "墨痕迷城",
      version: 2,
    });
    const archived = {
      ...updated,
      archivedFromStatus: "planning" as const,
      projectSequence: 3,
      status: "archived" as const,
      version: 3,
    };
    const restored = {
      ...updated,
      projectSequence: 4,
      version: 4,
    };
    const responses = [updated, archived, restored];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        const data = responses.shift();
        return new Response(JSON.stringify({ data }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      });
    render(<ProjectStudio initialProject={initialProject} />, {
      wrapper,
    });

    await user.click(
      screen.getByRole("button", { name: "编辑作品" }),
    );
    const title = screen.getByLabelText("书名");
    await user.clear(title);
    await user.type(title, "墨痕迷城");
    await user.click(
      screen.getByRole("button", { name: "保存修改" }),
    );
    await screen.findByRole("heading", { name: "墨痕迷城" });

    await user.click(
      screen.getByRole("button", { name: "归档作品" }),
    );
    await user.click(
      screen.getByRole("button", { name: "确认归档" }),
    );
    await screen.findByRole("button", { name: "恢复作品" });

    await user.click(
      screen.getByRole("button", { name: "恢复作品" }),
    );
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "归档作品" }),
      ).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      action: "update",
      expectedVersion: 1,
      patch: { title: "墨痕迷城" },
    });
    expect(
      JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)),
    ).toEqual({ expectedVersion: 2 });
    expect(
      JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)),
    ).toEqual({ expectedVersion: 3 });
  });

  it("详情 RSC 新快照覆盖旧导航缓存", () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(
      ["project", initialProject.id],
      { ...initialProject, title: "缓存旧标题" },
      { updatedAt: 100 },
    );

    render(
      <QueryClientProvider client={queryClient}>
        <ProjectStudio
          initialDataUpdatedAt={200}
          initialProject={{
            ...initialProject,
            title: "服务端新标题",
            version: 2,
          }}
        />
      </QueryClientProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "服务端新标题" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "缓存旧标题" }),
    ).not.toBeInTheDocument();
  });

  it("迟到的旧详情 RSC 不得降级较新版本缓存", () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(
      ["project", initialProject.id],
      {
        ...initialProject,
        projectSequence: 3,
        title: "缓存版本三",
        version: 3,
      },
      { updatedAt: 300 },
    );

    render(
      <QueryClientProvider client={queryClient}>
        <ProjectStudio
          initialDataUpdatedAt={400}
          initialProject={{
            ...initialProject,
            projectSequence: 2,
            title: "迟到版本二",
            version: 2,
          }}
        />
      </QueryClientProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "缓存版本三" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "迟到版本二" }),
    ).not.toBeInTheDocument();
  });

  it("编辑成功同步详情并失效所有项目列表缓存", async () => {
    const user = userEvent.setup();
    const queryClient = createTestQueryClient();
    const updated = nextProject({
      projectSequence: 2,
      title: "缓存同步新稿",
      version: 2,
    });
    queryClient.setQueryData(
      ["projects", "active", "", 1],
      { data: [initialProject] },
    );
    queryClient.setQueryData(
      ["projects", "archived", "", 1],
      { data: [] },
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: updated }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    render(
      <QueryClientProvider client={queryClient}>
        <ProjectStudio initialProject={initialProject} />
      </QueryClientProvider>,
    );

    await user.click(
      screen.getByRole("button", { name: "编辑作品" }),
    );
    const title = screen.getByLabelText("书名");
    await user.clear(title);
    await user.type(title, "缓存同步新稿");
    await user.click(
      screen.getByRole("button", { name: "保存修改" }),
    );
    await screen.findByRole("heading", { name: "缓存同步新稿" });

    expect(
      queryClient.getQueryData(["project", initialProject.id]),
    ).toEqual(updated);
    expect(
      queryClient.getQueryData<{
        readonly data: readonly NovelProject[];
      }>(["projects", "active", "", 1])?.data[0],
    ).toEqual(updated);
    expect(
      queryClient.getQueryState(["projects", "active", "", 1])
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(["projects", "archived", "", 1])
        ?.isInvalidated,
    ).toBe(true);
  });

  it("编辑冲突以最新聚合重基且只重试用户实际修改字段", async () => {
    const user = userEvent.setup();
    const latest = nextProject({
      projectSequence: 2,
      targetAudience: "服务器更新的目标读者",
      version: 2,
    });
    const updated = {
      ...latest,
      projectSequence: 3,
      title: "冲突后新稿",
      version: 3,
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(apiErrorResponse("编辑版本冲突"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: latest }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: updated }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
    render(<ProjectStudio initialProject={initialProject} />, {
      wrapper,
    });

    await user.click(
      screen.getByRole("button", { name: "编辑作品" }),
    );
    const dialog = screen.getByRole("dialog");
    const title = within(dialog).getByLabelText("书名");
    await user.clear(title);
    await user.type(title, "冲突后新稿");
    await user.click(
      within(dialog).getByRole("button", { name: "保存修改" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(title).toHaveValue("冲突后新稿");
    expect(
      within(dialog).getByLabelText("目标读者"),
    ).toHaveValue("服务器更新的目标读者");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "保存修改" }),
    );
    await screen.findByRole("heading", { name: "冲突后新稿" });

    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toEqual({
      action: "update",
      expectedVersion: 1,
      patch: { title: "冲突后新稿" },
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `/api/v1/projects/${initialProject.id}`,
    );
    expect(
      JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)),
    ).toEqual({
      action: "update",
      expectedVersion: 2,
      patch: { title: "冲突后新稿" },
    });
  });

  it("编辑冲突检测同一脏字段并要求确认后才能覆盖", async () => {
    const user = userEvent.setup();
    const latest = nextProject({
      projectSequence: 2,
      title: "服务器新标题",
      version: 2,
    });
    const updated = {
      ...latest,
      projectSequence: 3,
      title: "我的新标题",
      version: 3,
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(apiErrorResponse("编辑版本冲突"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: latest }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: updated }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
    render(<ProjectStudio initialProject={initialProject} />, {
      wrapper,
    });

    await user.click(
      screen.getByRole("button", { name: "编辑作品" }),
    );
    const dialog = screen.getByRole("dialog");
    const title = within(dialog).getByLabelText("书名");
    await user.clear(title);
    await user.type(title, "我的新标题");
    await user.click(
      within(dialog).getByRole("button", { name: "保存修改" }),
    );

    expect(
      await within(dialog).findByText(
        /服务器也修改了以下字段：书名/,
      ),
    ).toBeInTheDocument();
    expect(title).toHaveValue("我的新标题");
    await user.click(
      within(dialog).getByRole("button", { name: "保存修改" }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await user.click(
      within(dialog).getByRole("button", {
        name: "确认保留我的修改",
      }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "保存修改" }),
    );
    await screen.findByRole("heading", { name: "我的新标题" });
    expect(
      JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)),
    ).toEqual({
      action: "update",
      expectedVersion: 2,
      patch: { title: "我的新标题" },
    });
  });

  it("编辑冲突刷新失败在对话框内明确提示并保留输入", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(apiErrorResponse("编辑版本冲突"))
      .mockResolvedValueOnce(
        apiErrorResponse("读取最新作品失败", 503),
      );
    render(<ProjectStudio initialProject={initialProject} />, {
      wrapper,
    });

    await user.click(
      screen.getByRole("button", { name: "编辑作品" }),
    );
    const dialog = screen.getByRole("dialog");
    const title = within(dialog).getByLabelText("书名");
    await user.clear(title);
    await user.type(title, "未保存的新标题");
    await user.click(
      within(dialog).getByRole("button", { name: "保存修改" }),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "刷新最新版本失败：读取最新作品失败",
    );
    expect(title).toHaveValue("未保存的新标题");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("归档冲突刷新版本并在原对话框用新版本重试", async () => {
    const user = userEvent.setup();
    const latest = nextProject({
      projectSequence: 2,
      version: 2,
    });
    const archived = {
      ...latest,
      archivedFromStatus: "planning" as const,
      projectSequence: 3,
      status: "archived" as const,
      version: 3,
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(apiErrorResponse("归档版本冲突"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: latest }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: archived }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
    render(<ProjectStudio initialProject={initialProject} />, {
      wrapper,
    });

    await user.click(
      screen.getByRole("button", { name: "归档作品" }),
    );
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "确认归档" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "确认归档" }),
    );
    await screen.findByRole("button", { name: "恢复作品" });

    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toEqual({ expectedVersion: 1 });
    expect(
      JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)),
    ).toEqual({ expectedVersion: 2 });
  });

  it("恢复冲突刷新版本并用最新 expectedVersion 重试", async () => {
    const user = userEvent.setup();
    const archivedInitial = nextProject({
      archivedFromStatus: "planning",
      status: "archived",
    });
    const archivedLatest = {
      ...archivedInitial,
      projectSequence: 2,
      version: 2,
    };
    const restored = nextProject({
      projectSequence: 3,
      version: 3,
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(apiErrorResponse("恢复版本冲突"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: archivedLatest }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: restored }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
    render(<ProjectStudio initialProject={archivedInitial} />, {
      wrapper,
    });

    await user.click(
      screen.getByRole("button", { name: "恢复作品" }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(
      screen.getByRole("button", { name: "恢复作品" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "恢复作品" }),
    );
    await screen.findByRole("button", { name: "归档作品" });

    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toEqual({ expectedVersion: 1 });
    expect(
      JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)),
    ).toEqual({ expectedVersion: 2 });
  });

  it("编辑表单显示并提交领域允许的自定义题材", async () => {
    const user = userEvent.setup();
    const customProject = nextProject({ genre: "新怪谈" });
    const updated = {
      ...customProject,
      genre: "赛博武侠",
      projectSequence: 2,
      version: 2,
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ data: updated }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
    render(<ProjectStudio initialProject={customProject} />, {
      wrapper,
    });

    await user.click(
      screen.getByRole("button", { name: "编辑作品" }),
    );
    const genre = screen.getByLabelText("题材");
    expect(genre).toHaveValue("新怪谈");
    await user.clear(genre);
    await user.type(genre, "赛博武侠");
    await user.click(
      screen.getByRole("button", { name: "保存修改" }),
    );
    await screen.findByText("赛博武侠");

    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      expectedVersion: 1,
      patch: { genre: "赛博武侠" },
    });
  });

  it("归档操作先展示明确确认对话框", async () => {
    const user = userEvent.setup();
    render(<ProjectStudio initialProject={initialProject} />, {
      wrapper,
    });

    await user.click(
      screen.getByRole("button", { name: "归档作品" }),
    );

    expect(
      screen.getByRole("heading", { name: "归档这部作品？" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("归档不会删除任何内容"),
    ).toBeInTheDocument();
  });

  it("归档失败在确认对话框内播报并支持关闭清理与原地重试", async () => {
    const user = userEvent.setup();
    const archived = nextProject({
      archivedFromStatus: "planning",
      projectSequence: 2,
      status: "archived",
      version: 2,
    });
    const archiveError = () =>
      new Response(
        JSON.stringify({
          error: {
            code: "projects.unavailable",
            kind: "internal",
            message: "作品已被更新，暂时无法归档",
            retryable: false,
          },
        }),
        {
          headers: { "content-type": "application/json" },
          status: 503,
        },
      );
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(archiveError())
      .mockResolvedValueOnce(archiveError())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: archived }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
    render(<ProjectStudio initialProject={initialProject} />, {
      wrapper,
    });

    await user.click(
      screen.getByRole("button", { name: "归档作品" }),
    );
    let dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "确认归档" }),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "作品已被更新，暂时无法归档",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "取消" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "归档作品" }),
    );
    dialog = screen.getByRole("dialog");
    expect(
      within(dialog).queryByText("作品已被更新，暂时无法归档"),
    ).not.toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "确认归档" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "作品已被更新，暂时无法归档",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "确认归档" }),
    );

    await screen.findByRole("button", { name: "恢复作品" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("编辑服务端失败在对话框内播报、保留输入并可原地重试", async () => {
    const user = userEvent.setup();
    const updated = nextProject({
      projectSequence: 2,
      title: "墨痕迷城",
      version: 2,
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "projects.unavailable",
              kind: "internal",
              message: "作品已被更新，请刷新后重试",
              retryable: false,
            },
          }),
          {
            headers: { "content-type": "application/json" },
            status: 503,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: updated }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
    render(<ProjectStudio initialProject={initialProject} />, {
      wrapper,
    });

    await user.click(
      screen.getByRole("button", { name: "编辑作品" }),
    );
    const dialog = screen.getByRole("dialog");
    const title = within(dialog).getByLabelText("书名");
    await user.clear(title);
    await user.type(title, "墨痕迷城");
    await user.click(
      within(dialog).getByRole("button", { name: "保存修改" }),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "作品已被更新，请刷新后重试",
    );
    expect(title).toHaveValue("墨痕迷城");
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "保存修改" }),
    );
    await screen.findByRole("heading", { name: "墨痕迷城" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "编辑作品" }),
    );
    expect(
      within(screen.getByRole("dialog")).queryByText(
        "作品已被更新，请刷新后重试",
      ),
    ).not.toBeInTheDocument();
  });
});
