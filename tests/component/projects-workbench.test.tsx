import type { ReactNode } from "react";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProjectsWorkbench,
  type NovelProject,
  type ProjectPage,
} from "@/modules/projects";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

const project: NovelProject = {
  archivedFromStatus: null,
  createdAt: "2026-08-31T06:00:00.000Z",
  genre: "悬疑",
  id: "018f47a2-9000-7f11-8d24-4a1cc5e6d730",
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

const emptyPage: ProjectPage = {
  catalogVersion: 0,
  items: [],
  page: 1,
  pageSize: 12,
  total: 0,
  totalPages: 0,
};

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
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
  navigation.push.mockReset();
  vi.restoreAllMocks();
});

describe("新作品台", () => {
  it("RSC 空数据首屏提供完整空态与键盘可用创建入口", () => {
    render(<ProjectsWorkbench initialPage={emptyPage} />, { wrapper });

    expect(
      screen.getByRole("heading", { name: "作品台" }),
    ).toBeInTheDocument();
    expect(screen.getByText("还没有作品")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "新建作品" }),
    ).not.toHaveLength(0);
  });

  it("使用 React Hook Form 与 Zod 提交创建后进入新 SQLite 工作台", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ data: project }), {
          headers: { "content-type": "application/json" },
          status: 201,
        }),
      );
    render(<ProjectsWorkbench initialPage={emptyPage} />, { wrapper });

    await user.click(
      screen.getAllByRole("button", { name: "新建作品" })[0]!,
    );
    await user.type(screen.getByLabelText("书名"), "纸上迷城");
    await user.type(
      screen.getByLabelText("核心梗概"),
      "失忆校对员发现错字可以改写现实。",
    );
    await user.click(
      screen.getByRole("button", { name: "创建并进入工作台" }),
    );

    await waitFor(() => {
      expect(navigation.push).toHaveBeenCalledWith(
        `/studio/${project.id}`,
      );
    });
    const [, options] = fetchMock.mock.calls[0]!;
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/projects");
    expect(options).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(options?.body))).toMatchObject({
      genre: "悬疑",
      premise: "失忆校对员发现错字可以改写现实。",
      targetAudience: "成年类型文学读者",
      targetWordCount: 180_000,
      title: "纸上迷城",
    });
  });

  it("RSC 新首屏覆盖旧导航缓存且不会展示过期作品", () => {
    const queryClient = createTestQueryClient();
    const cachedProject = {
      ...project,
      id: "018f47a2-9000-7f11-8d24-4a1cc5e6d733",
      title: "缓存旧稿",
    };
    const freshProject = {
      ...project,
      id: "018f47a2-9000-7f11-8d24-4a1cc5e6d734",
      title: "服务端新稿",
      version: 2,
    };
    queryClient.setQueryData(
      ["projects", "active", "", 1],
      {
        data: [cachedProject],
        pagination: {
          page: 1,
          pageSize: 12,
          total: 1,
          totalPages: 1,
        },
      },
      { updatedAt: 100 },
    );

    render(
      <QueryClientProvider client={queryClient}>
        <ProjectsWorkbench
          initialDataUpdatedAt={200}
          initialPage={{
            catalogVersion: 1,
            items: [freshProject],
            page: 1,
            pageSize: 12,
            total: 1,
            totalPages: 1,
          }}
        />
      </QueryClientProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "服务端新稿" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "缓存旧稿" }),
    ).not.toBeInTheDocument();
  });

  it("迟到的旧列表 RSC 不得降级较新缓存", () => {
    const queryClient = createTestQueryClient();
    const cachedProject = {
      ...project,
      projectSequence: 3,
      title: "缓存版本三",
      version: 3,
    };
    const staleProject = {
      ...project,
      projectSequence: 2,
      title: "迟到版本二",
      version: 2,
    };
    queryClient.setQueryData(
      ["projects", "active", "", 1],
      {
        data: [cachedProject],
        pagination: {
          page: 1,
          pageSize: 12,
          total: 1,
          totalPages: 1,
        },
      },
      { updatedAt: 300 },
    );

    render(
      <QueryClientProvider client={queryClient}>
        <ProjectsWorkbench
          initialDataUpdatedAt={200}
          initialPage={{
            catalogVersion: 1,
            items: [staleProject],
            page: 1,
            pageSize: 12,
            total: 1,
            totalPages: 1,
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

  it("创建成功写入详情缓存并失效所有项目列表", async () => {
    const user = userEvent.setup();
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(
      ["projects", "archived", "", 1],
      { data: [], pagination: { page: 1 } },
    );
    queryClient.setQueryData(
      ["projects", "active", "纸", 2],
      { data: [], pagination: { page: 2 } },
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: project }), {
        headers: { "content-type": "application/json" },
        status: 201,
      }),
    );
    render(
      <QueryClientProvider client={queryClient}>
        <ProjectsWorkbench initialPage={emptyPage} />
      </QueryClientProvider>,
    );

    await user.click(
      screen.getAllByRole("button", { name: "新建作品" })[0]!,
    );
    await user.type(screen.getByLabelText("书名"), "纸上迷城");
    await user.type(
      screen.getByLabelText("核心梗概"),
      "失忆校对员发现错字可以改写现实。",
    );
    await user.click(
      screen.getByRole("button", { name: "创建并进入工作台" }),
    );

    await waitFor(() => {
      expect(queryClient.getQueryData(["project", project.id])).toEqual(
        project,
      );
    });
    expect(
      queryClient.getQueryState(["projects", "archived", "", 1])
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(["projects", "active", "纸", 2])
        ?.isInvalidated,
    ).toBe(true);
  });

  it("必填语义、错误关联与客户端校验信息完整且为中文", async () => {
    const user = userEvent.setup();
    render(<ProjectsWorkbench initialPage={emptyPage} />, { wrapper });

    await user.click(
      screen.getAllByRole("button", { name: "新建作品" })[0]!,
    );
    const dialog = screen.getByRole("dialog");
    const title = within(dialog).getByLabelText("书名");
    const subtitle = within(dialog).getByLabelText("副标题（选填）");
    const targetWordCount = within(dialog).getByLabelText("目标字数");
    const chatModel = within(dialog).getByLabelText("聊天模型");

    expect(title).toBeRequired();
    expect(title).toHaveAttribute("aria-required", "true");
    expect(targetWordCount).toBeRequired();
    expect(subtitle).not.toBeRequired();
    expect(subtitle).not.toHaveAttribute("aria-required");
    expect(chatModel).not.toBeRequired();
    expect(chatModel).not.toHaveAttribute("aria-required");

    await user.clear(targetWordCount);
    fireEvent.change(chatModel, {
      target: { value: "m".repeat(161) },
    });
    await user.click(
      within(dialog).getByRole("button", {
        name: "创建并进入工作台",
      }),
    );

    const titleError = await within(dialog).findByText("请输入书名");
    const wordCountError = within(dialog).getByText(
      "请输入有效的目标字数",
    );
    const modelError = within(dialog).getByText(
      "聊天模型 ID 不能超过 160 个字符",
    );
    expect(titleError).toHaveAttribute("id", "project-title-error");
    expect(title).toHaveAttribute(
      "aria-describedby",
      "project-title-error",
    );
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(wordCountError).toHaveAttribute(
      "id",
      "project-target-word-count-error",
    );
    expect(targetWordCount).toHaveAttribute(
      "aria-describedby",
      "project-target-word-count-error",
    );
    expect(modelError).toHaveAttribute(
      "id",
      "project-chat-model-error",
    );
    expect(chatModel).toHaveAttribute(
      "aria-describedby",
      "project-chat-model-error",
    );
    expect(
      within(dialog).getAllByRole("alert").every((alert) =>
        /[\u3400-\u9fff]/u.test(alert.textContent ?? ""),
      ),
    ).toBe(true);
  });

  it("创建服务端失败在对话框内播报、保留输入并可原地重试", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "projects.version_conflict",
              kind: "conflict",
              message: "作品创建冲突，请重试",
              retryable: false,
            },
          }),
          {
            headers: { "content-type": "application/json" },
            status: 409,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: project }), {
          headers: { "content-type": "application/json" },
          status: 201,
        }),
      );
    render(<ProjectsWorkbench initialPage={emptyPage} />, { wrapper });

    await user.click(
      screen.getAllByRole("button", { name: "新建作品" })[0]!,
    );
    const dialog = screen.getByRole("dialog");
    const title = within(dialog).getByLabelText("书名");
    await user.type(title, "纸上迷城");
    await user.type(
      within(dialog).getByLabelText("核心梗概"),
      "失忆校对员发现错字可以改写现实。",
    );
    await user.click(
      within(dialog).getByRole("button", {
        name: "创建并进入工作台",
      }),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "作品创建冲突，请重试",
    );
    expect(title).toHaveValue("纸上迷城");
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", {
        name: "创建并进入工作台",
      }),
    );
    await waitFor(() => {
      expect(navigation.push).toHaveBeenCalledWith(
        `/studio/${project.id}`,
      );
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("分页控件通过 TanStack Query 获取下一页", async () => {
    const user = userEvent.setup();
    const secondProject = {
      ...project,
      id: "018f47a2-9000-7f11-8d24-4a1cc5e6d732",
      title: "远星回声",
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [secondProject],
            pagination: {
              page: 2,
              pageSize: 12,
              total: 13,
              totalPages: 2,
            },
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        ),
      );
    render(
      <ProjectsWorkbench
        initialPage={{
          catalogVersion: 1,
          items: [project],
          page: 1,
          pageSize: 12,
          total: 13,
          totalPages: 2,
        }}
      />,
      { wrapper },
    );

    await user.click(
      screen.getByRole("button", { name: "下一页" }),
    );

    await screen.findByRole("heading", { name: "远星回声" });
    expect(fetchMock.mock.calls[0]?.[0]).toContain("page=2");
  });
});
