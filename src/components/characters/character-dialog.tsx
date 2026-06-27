"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Character } from "@/lib/types";

const ROLE_OPTIONS = ["主角", "反派", "配角", "配角（重要）", "龙套"];

interface Props {
  projectId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  character?: Character | null;
  onSaved: (c: Character) => void;
}

export function CharacterDialog({
  projectId,
  open,
  onOpenChange,
  character,
  onSaved,
}: Props) {
  const [form, setForm] = useState<Character>(() =>
    character ? { ...character } : emptyCharacter(),
  );
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error("请输入角色名");
      return;
    }
    setSaving(true);
    try {
      const isEdit = !!character?.id;
      const result = isEdit
        ? await api.updateCharacter(projectId, character!.id, form)
        : await api.upsertCharacter(projectId, form);
      onSaved(result.character);
      toast.success(isEdit ? "已更新角色" : "已创建角色");
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{character ? "编辑角色" : "新建角色"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>姓名 *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="角色名"
              />
            </div>
            <div className="space-y-1.5">
              <Label>定位</Label>
              <Input
                list="role-options"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              />
              <datalist id="role-options">
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>别名/称号</Label>
            <Input
              value={(form.aliases || []).join("、")}
              onChange={(e) =>
                setForm({
                  ...form,
                  aliases: e.target.value
                    .split(/[、,，\s]+/)
                    .filter(Boolean),
                })
              }
              placeholder="用顿号分隔"
            />
          </div>
          <Field
            label="外貌"
            value={form.appearance}
            onChange={(v) => setForm({ ...form, appearance: v })}
          />
          <Field
            label="性格"
            value={form.personality}
            onChange={(v) => setForm({ ...form, personality: v })}
          />
          <Field
            label="背景"
            value={form.background}
            onChange={(v) => setForm({ ...form, background: v })}
            textarea
          />
          <Field
            label="目标/动机"
            value={form.goals}
            onChange={(v) => setForm({ ...form, goals: v })}
          />
          <Field
            label="能力/特长"
            value={form.abilities}
            onChange={(v) => setForm({ ...form, abilities: v })}
          />
          <Field
            label="备注"
            value={form.notes}
            onChange={(v) => setForm({ ...form, notes: v })}
            textarea
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function emptyCharacter(): Character {
  return {
    id: "",
    name: "",
    role: "配角",
    aliases: [],
    appearance: "",
    personality: "",
    background: "",
    goals: "",
    abilities: "",
    notes: "",
    relationships: [],
  };
}

function Field({
  label,
  value,
  onChange,
  textarea,
}: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
  textarea?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {textarea ? (
        <Textarea
          rows={2}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Input value={value || ""} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}
