"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";

export interface CharacterNodeData {
  name: string;
  role: string;
  selected?: boolean;
  [key: string]: unknown;
}

function CharacterNodeBase({ data }: NodeProps) {
  const d = data as CharacterNodeData;
  return (
    <div
      className={cn(
        "flex w-32 flex-col items-center gap-1 rounded-xl border-2 bg-card p-3 shadow-sm transition-shadow hover:shadow-md",
        d.selected ? "border-primary" : "border-border",
      )}
    >
      <Handle
        type="source"
        position={Position.Top}
        className="!h-2 !w-2 !border-0 !bg-transparent"
      />
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-violet-400 to-violet-600 text-lg font-semibold text-white">
        {d.name.slice(0, 1)}
      </div>
      <div className="text-center">
        <p className="text-sm font-medium leading-tight">{d.name}</p>
        <p className="text-xs text-muted-foreground">{d.role}</p>
      </div>
      <Handle
        type="target"
        position={Position.Bottom}
        className="!h-2 !w-2 !border-0 !bg-transparent"
      />
    </div>
  );
}

export const CharacterNode = memo(CharacterNodeBase);
