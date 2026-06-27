"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CharacterDialog } from "@/components/characters/character-dialog";
import { useProjectStore } from "@/lib/store";
import { api } from "@/lib/api";
import type { Character } from "@/lib/types";

export default function CharactersPage() {
  return <CharactersContent />;
}

function CharactersContent() {
  const { project, characters, upsertCharacterLocal, removeCharacterLocal } =
    useProjectStore();
  const projectId = project?.id ?? "";
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Character | null>(null);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(c: Character) {
    setEditing(c);
    setDialogOpen(true);
  }

  async function handleDelete(c: Character) {
    if (!confirm(`删除角色「${c.name}」？相关关系也会清除。`)) return;
    try {
      await api.deleteCharacter(projectId, c.id);
      removeCharacterLocal(c.id);
      toast.success("已删除");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-8 py-8">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">角色</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              共 {characters.length} 个角色
            </p>
          </div>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            新建角色
          </Button>
        </header>

        {characters.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 border-dashed py-16 text-center">
            <Users className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              还没有角色，点击「新建角色」或在 AI 对话中让 AI 帮你创建
            </p>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {characters.map((c) => (
              <Card key={c.id} className="group relative p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100 text-sm font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                      {c.name.slice(0, 1)}
                    </div>
                    <div>
                      <h3 className="font-semibold leading-tight">{c.name}</h3>
                      <Badge variant="secondary" className="mt-1 text-xs">
                        {c.role}
                      </Badge>
                    </div>
                  </div>
                </div>
                {c.aliases && c.aliases.length > 0 && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    又称：{c.aliases.join("、")}
                  </p>
                )}
                {c.personality && (
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                    {c.personality}
                  </p>
                )}
                {c.relationships && c.relationships.length > 0 && (
                  <p className="mt-3 text-xs text-muted-foreground/70">
                    {c.relationships.length} 段关系
                  </p>
                )}
                <div className="mt-4 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEdit(c)}
                  >
                    <Pencil className="mr-1.5 h-3 w-3" />
                    编辑
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(c)}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <CharacterDialog
        key={`${editing?.id ?? "new"}-${dialogOpen}`}
        projectId={projectId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        character={editing}
        onSaved={upsertCharacterLocal}
      />
    </div>
  );
}
