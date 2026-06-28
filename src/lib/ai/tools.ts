import "server-only";
import { tool } from "ai";
import { z } from "zod";
import * as storage from "@/lib/storage";
import {
  CreateChapterOutlineInputSchema,
  UpsertCharacterInputSchema,
  UpsertPlotPointInputSchema,
  UpsertRelationshipInputSchema,
  UpsertWorldSectionInputSchema,
} from "@/lib/types";

const VoidSchema = z.object({}).describe("无参数");

const DeleteByIdSchema = z.object({
  id: z.string().describe("要删除对象的 id"),
});

/**
 * 统一包装工具 execute：捕获异常，避免单次工具失败导致整个流崩溃。
 */
function safe<TArgs, TResult>(
  run: (input: TArgs) => Promise<TResult>,
): (input: TArgs) => Promise<TResult | { success: false; message: string }> {
  return async (input) => {
    try {
      return await run(input);
    } catch (e) {
      return { success: false, message: (e as Error).message };
    }
  };
}

/**
 * 构建 AI 工具集。所有工具绑定到指定 projectId，
 * 在 streamText 中被模型调用时，execute 会写入文件系统并返回可读结果。
 */
export function buildTools(projectId: string) {
  return {
    upsert_character: tool({
      description:
        "创建或更新一个角色。当对话中讨论到一个角色（新角色或已有角色的细节补充）时调用。更新已有角色时传 id 或同名时（将自动匹配）。",
      inputSchema: UpsertCharacterInputSchema,
      execute: safe(async (input) => {
        const created = await storage.upsertCharacter(projectId, input);
        return {
          success: true,
          id: created.id,
          name: created.name,
          message: `已${input.id ? "更新" : "创建"}角色「${created.name}」(${created.role})`,
        };
      }),
    }),

    delete_character: tool({
      description: "删除一个角色（按 id）。删除后会同时清除指向它的关系。",
      inputSchema: DeleteByIdSchema,
      execute: safe(async ({ id }) => {
        await storage.deleteCharacter(projectId, id);
        return { success: true, message: `已删除角色 (${id})` };
      }),
    }),

    upsert_relationship: tool({
      description:
        "为某角色建立或更新与其他角色的关系。characterId 为发起方角色 id，targetName 为目标角色名称（自动匹配）。关系类型：family亲人/friend朋友/lover恋人/mentor师徒/rival竞争对手/enemy敌对/ally盟友/other其他。",
      inputSchema: UpsertRelationshipInputSchema,
      execute: safe(async (input) => {
        const updated = await storage.upsertRelationship(
          projectId,
          input.characterId,
          {
            targetName: input.targetName,
            type: input.type,
            description: input.description,
          },
        );
        if (!updated) {
          return { success: false, message: "未找到发起方角色" };
        }
        return {
          success: true,
          message: `已为「${updated.name}」设定与「${input.targetName}」的关系：${input.type}`,
        };
      }),
    }),

    upsert_world_section: tool({
      description:
        "创建或更新一条世界观设定。category 可选：geography地理/history历史/faction势力/magic魔法力量体系/culture文化风俗/technology科技/other其他。",
      inputSchema: UpsertWorldSectionInputSchema,
      execute: safe(async (input) => {
        const created = await storage.upsertWorldSection(projectId, input);
        return {
          success: true,
          id: created.id,
          message: `已${input.id ? "更新" : "创建"}世界观条目[${created.category}]「${created.title}」`,
        };
      }),
    }),

    upsert_plot_point: tool({
      description:
        "创建或更新一个剧情节点（按幕 act 和顺序 order 组织）。可关联涉及的角色 characterIds。",
      inputSchema: UpsertPlotPointInputSchema,
      execute: safe(async (input) => {
        const created = await storage.upsertPlotPoint(projectId, input);
        return {
          success: true,
          id: created.id,
          message: `已${input.id ? "更新" : "创建"}剧情节点（第${created.act}幕）「${created.title}」`,
        };
      }),
    }),

    create_chapter_outline: tool({
      description:
        "创建一章的大纲（不含正文）。当确定了章节规划或剧情需要落到章节时调用。",
      inputSchema: CreateChapterOutlineInputSchema,
      execute: safe(async (input) => {
        const created = await storage.upsertChapter(projectId, {
          title: input.title,
          order: input.order,
          outline: input.outline,
          status: "outline",
        });
        return {
          success: true,
          id: created.id,
          message: `已创建第${created.order}章大纲「${created.title}」`,
        };
      }),
    }),

    list_relationship_types: tool({
      description: "查询可选的关系类型及其说明（当不确定 type 取值时调用）。",
      inputSchema: VoidSchema,
      execute: async () => {
        return {
          types: [
            "family亲人",
            "friend朋友",
            "lover恋人",
            "mentor师徒",
            "rival竞争对手",
            "enemy敌对",
            "ally盟友",
            "other其他",
          ],
        };
      },
    }),
  };
}
