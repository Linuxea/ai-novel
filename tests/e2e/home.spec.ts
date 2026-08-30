import { expect, test } from "./database-fixture";

test("空作品台完成创建、打开、编辑、归档与恢复", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("墨章 · AI 小说生成器");
  await expect(page.getByRole("heading", { name: "作品台" })).toBeVisible();
  await expect(page.getByText("还没有作品")).toBeVisible();

  await page.getByRole("button", { name: "新建作品" }).first().click();
  await page.getByLabel("书名").fill("纸上迷城");
  await page
    .getByLabel("核心梗概")
    .fill("失忆校对员发现错字可以改写现实。");
  await page
    .getByRole("button", { name: "创建并进入工作台" })
    .click();

  await expect(page).toHaveURL(/\/studio\/[0-9a-f-]+$/);
  await expect(
    page.getByRole("heading", { name: "纸上迷城" }),
  ).toBeVisible();
  await expect(page.getByText("故事核心")).toBeVisible();

  await page.getByRole("button", { name: "编辑作品" }).click();
  await page.getByLabel("书名").fill("墨痕迷城");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(
    page.getByRole("heading", { name: "墨痕迷城" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "归档作品" }).click();
  await expect(
    page.getByRole("heading", { name: "归档这部作品？" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "确认归档" }).click();
  await expect(
    page.getByRole("button", { name: "恢复作品" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "恢复作品" }).click();
  await expect(
    page.getByRole("button", { name: "归档作品" }),
  ).toBeVisible();
});
