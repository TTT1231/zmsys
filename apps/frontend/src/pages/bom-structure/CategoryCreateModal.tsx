import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/toastContexts";
import { useCreateBomCategory } from "@/data/queries";
import { uuid } from "@/lib/utils";
import type { DraftNodeInput } from "@/api";
import { StructureEditor, type EditorActions } from "./StructureEditor";
import { viewTreeOfDraft } from "./structureView";

/** 新建品类（仅超管）：名称 + 编码前缀 + 整棵草稿树一次保存；内部 key 与雪花 id 由后端生成 */
export function CategoryCreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const createCategory = useCreateBomCategory();
    const toast = useToast();
    const [name, setName] = useState("");
    const [codePrefix, setCodePrefix] = useState("");
    const [drafts, setDrafts] = useState<DraftNodeInput[]>([]);
    const [errors, setErrors] = useState<Record<string, string>>({});

    const close = () => {
        setName("");
        setCodePrefix("");
        setDrafts([]);
        setErrors({});
        onClose();
    };

    const actions: EditorActions = {
        addSection: sectionName =>
            setDrafts(current => [...current, { kind: "SECTION", tempId: uuid(), name: sectionName }]),
        addGroup: (parentId, groupName, multi, qty, isModel, items) =>
            setDrafts(current => [
                ...current,
                {
                    kind: "GROUP",
                    tempId: uuid(),
                    name: groupName,
                    ...(parentId ? { parentTempId: parentId } : {}),
                    multi,
                    qty,
                    ...(isModel ? { isModel: true } : {}),
                    items: items.map(item => ({ tempId: uuid(), name: item })),
                },
            ]),
        addItem: (groupId, itemName) =>
            setDrafts(current =>
                current.map(node =>
                    node.kind === "GROUP" && node.tempId === groupId
                        ? { ...node, items: [...(node.items ?? []), { tempId: uuid(), name: itemName }] }
                        : node,
                ),
            ),
        // 草稿节点（新建模式）不走隐藏/恢复——未保存的节点直接移除即可；编辑器
        // create 模式不渲染隐藏/恢复按钮，此实现仅作类型占位
        setHidden: () => undefined,
        move: (kind, id, direction) => {
            setDrafts(current => {
                const swap = <T extends { tempId: string }>(rows: T[]): T[] => {
                    const index = rows.findIndex(row => row.tempId === id);
                    const target = direction === "up" ? index - 1 : index + 1;
                    if (index < 0 || target < 0 || target >= rows.length) {
                        return rows;
                    }
                    const next = [...rows];
                    [next[index], next[target]] = [next[target]!, next[index]!];
                    return next;
                };
                if (kind === "item") {
                    return current.map(node =>
                        node.kind === "GROUP" && (node.items ?? []).some(item => item.tempId === id)
                            ? { ...node, items: swap(node.items ?? []) }
                            : node,
                    );
                }
                return swap(current);
            });
        },
        setRules: (groupId, multi, qty) =>
            setDrafts(current =>
                current.map(node =>
                    node.kind === "GROUP" && node.tempId === groupId ? { ...node, multi, qty } : node,
                ),
            ),
        removeDraft: (kind, id) => {
            setDrafts(current => {
                if (kind === "item") {
                    return current.map(node =>
                        node.kind === "GROUP"
                            ? { ...node, items: (node.items ?? []).filter(item => item.tempId !== id) }
                            : node,
                    );
                }
                // 移除分区/分组：连带其草稿子项（已保存节点不走移除，仅隐藏）
                const removed = new Set<string>([id]);
                return current
                    .filter(node => node.tempId !== id)
                    .filter(node => !(node.kind === "GROUP" && node.parentTempId && removed.has(node.parentTempId)));
            });
        },
    };

    const submit = () => {
        const nextErrors: Record<string, string> = {};
        if (!name.trim()) {
            nextErrors.name = "请填写品类名称";
        }
        if (!/^[A-Z0-9]{1,16}$/.test(codePrefix)) {
            nextErrors.codePrefix = "1-16 位大写字母/数字（如 QA）";
        }
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length > 0) {
            return;
        }
        createCategory.mutate(
            { name: name.trim(), codePrefix, groups: drafts },
            {
                onSuccess: created => {
                    toast.success(`品类「${created.name}」已创建`);
                    close();
                },
            },
        );
    };

    return (
        <Modal
            open={open}
            onClose={close}
            title="新建品类"
            subtitle="名称与编码前缀必填；整棵结构树一次保存，成功后才对新建 BOM 可见（品类 key 与分组内部标识由后端生成）"
            label="新建品类"
            width={760}
        >
            <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                    label="品类名称"
                    required
                    value={name}
                    error={errors.name}
                    placeholder="如：新品类1"
                    onChange={event => setName(event.target.value)}
                />
                <TextField
                    label="编码前缀"
                    required
                    value={codePrefix}
                    error={errors.codePrefix}
                    hint="BOM 编码 = 前缀 + 序号；不得与既有前缀构成数字延长冲突（如已有 XK2 时不可用 XK21）"
                    placeholder="如：QA"
                    onChange={event => setCodePrefix(event.target.value.toUpperCase())}
                />
            </div>
            <div className="mt-4 max-h-96 overflow-y-auto rounded-panel border border-line bg-surface px-4 py-3">
                <StructureEditor roots={viewTreeOfDraft(drafts)} actions={actions} mode="create" />
            </div>
            <div className="mt-4 flex justify-end gap-2">
                <Button size="sm" variant="secondary" onClick={close}>
                    取消
                </Button>
                <Button size="sm" onClick={submit} disabled={createCategory.isPending}>
                    保存品类
                </Button>
            </div>
        </Modal>
    );
}
