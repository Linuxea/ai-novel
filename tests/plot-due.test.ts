import { describe, expect, it } from "vitest";
import { classifyDuePlotNotes, inferCurrentOrder } from "@/lib/plot-due";
import type { PlotNote } from "@/lib/types";

function plotNote(overrides: Partial<PlotNote>): PlotNote {
  return {
    id: "plot-1",
    type: "foreshadow",
    title: "胎记",
    content: "",
    status: "idea",
    characterIds: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("plot due classification", () => {
  it("treats active foreshadows as planted", () => {
    const due = classifyDuePlotNotes(
      [plotNote({ status: "active", expectedPlantChapter: 2 })],
      3,
    );
    expect(due.mustPlant).toHaveLength(0);
  });

  it("uses the first unfinished chapter as the current order", () => {
    expect(
      inferCurrentOrder([
        { order: 1, status: "done" },
        { order: 2, status: "drafting" },
        { order: 3, status: "outline" },
      ]),
    ).toBe(2);
  });
});
