"use client";

import { useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import { Plus, GitFork } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { CharacterNode, type CharacterNodeData } from "@/components/graph/character-node";
import { useProjectStore } from "@/lib/store";
import { api } from "@/lib/api";
import {
  RELATIONSHIP_META,
  type Character,
  type RelationshipType,
} from "@/lib/types";

const nodeTypes: NodeTypes = { character: CharacterNode };

/** 圆形布局：把没有预设位置的角色均匀排布 */
function circleLayout(count: number, radius = 220) {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    return { x: Math.cos(angle) * radius + 350, y: Math.sin(angle) * radius + 300 };
  });
}

export function RelationshipGraph({ projectId }: { projectId: string }) {
  const { characters, reload } = useProjectStore(
    useShallow((s) => ({ characters: s.characters, reload: s.reload })),
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  // 从角色数据映射节点/边
  useEffect(() => {
    const positions = circleLayout(characters.length);
    const newNodes: Node<CharacterNodeData>[] = characters.map((c, i) => ({
      id: c.id,
      type: "character",
      position: c.layoutPosition ?? positions[i],
      data: { name: c.name, role: c.role },
    }));

    const newEdges: Edge[] = [];
    for (const c of characters) {
      for (const r of c.relationships ?? []) {
        const meta = RELATIONSHIP_META[r.type];
        newEdges.push({
          id: `${c.id}-${r.targetId}-${r.id}`,
          source: c.id,
          target: r.targetId,
          label: meta.label,
          labelStyle: { fontSize: 11, fill: meta.color },
          labelBgStyle: { fill: "#fff" },
          style: { stroke: meta.color, strokeWidth: 2 },
          animated: r.type === "rival" || r.type === "enemy",
        });
      }
    }

    setNodes(newNodes);
    setEdges(newEdges);
  }, [characters, setNodes, setEdges]);

  const onNodeDragStop = useCallback(
    async (_evt: unknown, node: Node) => {
      try {
        await api.saveCharacterLayout(projectId, node.id, node.position);
      } catch {
        /* 静默失败 */
      }
    },
    [projectId],
  );

  const hasGraph = characters.length > 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-6">
        <div className="flex items-center gap-2">
          <GitFork className="h-4 w-4 text-primary" />
          <h1 className="font-semibold">角色关系图谱</h1>
        </div>
        <Button
          size="sm"
          onClick={() => setDialogOpen(true)}
          disabled={characters.length < 2}
        >
          <Plus className="mr-2 h-3.5 w-3.5" />
          添加关系
        </Button>
      </header>

      <div className="relative flex-1">
        {hasGraph ? (
          <>
            <ReactFlowProvider>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeDragStop={onNodeDragStop}
                fitView
                fitViewOptions={{ padding: 0.3 }}
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={16} size={1} />
                <Controls />
                <MiniMap
                  pannable
                  zoomable
                  nodeColor={() => "#7c3aed"}
                  maskColor="rgba(0,0,0,0.05)"
                />
              </ReactFlow>
            </ReactFlowProvider>
            <Legend />
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <GitFork className="h-10 w-10 text-muted-foreground/40" />
            <div>
              <p className="font-medium">还没有角色</p>
              <p className="mt-1 text-sm text-muted-foreground">
                先在「角色」或「AI 对话」中创建至少 2 个角色
              </p>
            </div>
          </div>
        )}
      </div>

      <AddRelationshipDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        projectId={projectId}
        characters={characters}
        onAdded={reload}
      />
    </div>
  );
}

function Legend() {
  const types = Object.entries(RELATIONSHIP_META);
  return (
    <div className="absolute bottom-4 left-4 flex flex-wrap gap-x-4 gap-y-1 rounded-lg border bg-background/90 p-3 text-xs shadow-sm backdrop-blur">
      {types.map(([key, meta]) => (
        <span key={key} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: meta.color }}
          />
          {meta.label}
        </span>
      ))}
    </div>
  );
}

function AddRelationshipDialog({
  open,
  onOpenChange,
  projectId,
  characters,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  characters: Character[];
  onAdded: () => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [type, setType] = useState<RelationshipType>("friend");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    if (!from || !to) {
      toast.error("请选择两个角色");
      return;
    }
    if (from === to) {
      toast.error("不能与自身建立关系");
      return;
    }
    setSaving(true);
    try {
      const targetName = characters.find((c) => c.id === to)?.name ?? "";
      await api.addRelationship(projectId, {
        characterId: from,
        targetName,
        type,
        description: desc,
      });
      await onAdded();
      toast.success("已添加关系");
      onOpenChange(false);
      setFrom("");
      setTo("");
      setDesc("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>添加角色关系</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>从（角色）</Label>
            <Select value={from} onValueChange={(v) => setFrom(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="选择角色" />
              </SelectTrigger>
              <SelectContent>
                {characters.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}（{c.role}）
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>到（角色）</Label>
            <Select value={to} onValueChange={(v) => setTo(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="选择角色" />
              </SelectTrigger>
              <SelectContent>
                {characters.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}（{c.role}）
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>关系类型</Label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(RELATIONSHIP_META).map(([key, meta]) => (
                <Badge
                  key={key}
                  variant={type === key ? "default" : "outline"}
                  className="cursor-pointer"
                  style={type === key ? { backgroundColor: meta.color } : {}}
                  onClick={() => setType(key as RelationshipType)}
                >
                  {meta.label}
                </Badge>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>描述（选填）</Label>
            <Input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="如：青梅竹马、宿敌…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleAdd} disabled={saving}>
            {saving ? "添加中…" : "添加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
