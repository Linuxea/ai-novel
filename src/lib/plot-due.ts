import type { PlotNote } from "@/lib/types";

/** 临近窗口：到期前 N 章开始提示"宜铺垫" */
export const APPROACH_WINDOW = 2;

export interface DueClassification {
  mustResolve: PlotNote[];
  mustPlant: PlotNote[];
  approaching: PlotNote[];
  dueArcs: PlotNote[];
  otherPending: PlotNote[];
}

/**
 * 按"当前写作章 currentOrder"对未收束的剧情规划分类。
 * 纯函数，server / client 共用——writer prompt 注入与 planning/editor 角标
 * 必须用同一份判定逻辑，避免口径漂移。
 */
export function classifyDuePlotNotes(
  notes: PlotNote[],
  currentOrder: number,
): DueClassification {
  const result: DueClassification = {
    mustResolve: [],
    mustPlant: [],
    approaching: [],
    dueArcs: [],
    otherPending: [],
  };

  for (const p of notes) {
    if (p.status === "resolved") continue;

    const isPlanted = p.plantedInChapter != null;
    const isResolved = p.resolvedInChapter != null;

    if (
      p.type === "foreshadow" &&
      !isResolved &&
      p.expectedResolveChapter != null &&
      p.expectedResolveChapter <= currentOrder
    ) {
      result.mustResolve.push(p);
    } else if (
      p.type === "foreshadow" &&
      !isPlanted &&
      p.expectedPlantChapter != null &&
      p.expectedPlantChapter <= currentOrder
    ) {
      result.mustPlant.push(p);
    } else if (
      p.type === "foreshadow" &&
      !isResolved &&
      p.expectedResolveChapter != null
    ) {
      const diff = p.expectedResolveChapter - currentOrder;
      if (diff > 0 && diff <= APPROACH_WINDOW) {
        result.approaching.push(p);
      } else {
        result.otherPending.push(p);
      }
    } else {
      result.otherPending.push(p);
    }
  }

  return result;
}

/** 本章是否有需要强制处理的伏笔（用于 UI 角标） */
export function hasUrgentDue(due: DueClassification): boolean {
  return due.mustResolve.length > 0 || due.mustPlant.length > 0;
}

/** 取"当前写作章"：第一个未完成章的 order，全完成则返回 undefined */
export function inferCurrentOrder(orders: number[]): number | undefined {
  const sorted = [...orders].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== i + 1) return sorted[i] ?? i + 1;
  }
  return undefined;
}

/** 把分类结果渲染成 prompt 中的"本章需处理"段落（中文） */
export function renderDueSection(
  due: DueClassification,
  currentOrder: number,
): string {
  const parts: string[] = [];

  if (due.mustResolve.length) {
    parts.push(
      `## 必须在本章回收（已到期/逾期）`,
      due.mustResolve
        .map(
          (p) =>
            `- 《${p.title}》：${p.content || "（无详情）"}（预期第${p.expectedResolveChapter}章回收，现已第${currentOrder}章）`,
        )
        .join("\n"),
    );
  }

  if (due.mustPlant.length) {
    parts.push(
      `## 必须在本章埋下`,
      due.mustPlant
        .map(
          (p) =>
            `- 《${p.title}》：${p.content || "（无详情）"}（预期第${p.expectedPlantChapter}章埋）`,
        )
        .join("\n"),
    );
  }

  if (due.approaching.length) {
    parts.push(
      `## 临近回收（本章宜铺垫，为后续回收蓄势）`,
      due.approaching
        .map(
          (p) =>
            `- 《${p.title}》：还剩 ${p.expectedResolveChapter! - currentOrder} 章到期`,
        )
        .join("\n"),
    );
  }

  if (parts.length === 0) return "（本章无强制到期的伏笔，按大纲自由发挥即可）";
  return parts.join("\n\n");
}
