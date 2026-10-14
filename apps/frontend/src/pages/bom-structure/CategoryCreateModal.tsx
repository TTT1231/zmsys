import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Icon } from "@/lib/icons";
import { useToast } from "@/components/ui/toastContexts";
import { useCreateBomCategory } from "@/data/queries";
import type { BomStructureCategoryCreated } from "@/api";

/**
 * 新建品类（BOM结构原型.html 交互）：名称 + 编码前缀，可选「设置下属类型」
 * （每个类型一行 名称 + 前缀）——创建后主品类为复合品类，类型为目录容器，
 * 建档时必选其一；结构树在主编辑器里逐品类搭建（创建时不再内嵌整树编辑）。
 */
export function CategoryCreateModal({
    open,
    onClose,
    onCreated,
}: {
    open: boolean;
    onClose: () => void;
    /** 创建成功后切换到首个下属类型（无类型则切到新品类本身） */
    onCreated: (created: BomStructureCategoryCreated) => void;
}) {
    const createCategory = useCreateBomCategory();
    const toast = useToast();
    const [name, setName] = useState("");
    const [codePrefix, setCodePrefix] = useState("");
    const [hasTypes, setHasTypes] = useState(false);
    const [types, setTypes] = useState<Array<{ name: string; codePrefix: string }>>([{ name: "", codePrefix: "" }]);
    const [error, setError] = useState("");

    const close = () => {
        setName("");
        setCodePrefix("");
        setHasTypes(false);
        setTypes([{ name: "", codePrefix: "" }]);
        setError("");
        onClose();
    };

    const addRow = () => {
        // 后端 CreateBomCategoryDto 上限 12 个类型：到顶后按钮不再追加
        setTypes(current => (current.length >= 12 ? current : [...current, { name: "", codePrefix: "" }]));
        setError("");
    };

    const submit = () => {
        const trimmedName = name.trim();
        const filledTypes = hasTypes
            ? types.map(row => ({ name: row.name.trim(), codePrefix: row.codePrefix.trim() }))
            : [];
        if (!trimmedName) {
            setError("请填写品类名称");
            return;
        }
        if (!/^[A-Z0-9]{1,16}$/.test(codePrefix)) {
            setError("品类编码前缀为 1-16 位大写字母/数字（如 QA）");
            return;
        }
        if (hasTypes) {
            if (filledTypes.some(row => !row.name || !row.codePrefix)) {
                setError("请填写每个下属类型的名称与前缀，或删除空白行");
                return;
            }
            const names = [trimmedName, ...filledTypes.map(row => row.name)];
            if (new Set(names).size !== names.length) {
                setError("品类名称与下属类型名称不能重复");
                return;
            }
            const prefixes = [codePrefix, ...filledTypes.map(row => row.codePrefix)];
            if (filledTypes.some(row => !/^[A-Z0-9]{1,16}$/.test(row.codePrefix))) {
                setError("下属类型前缀为 1-16 位大写字母/数字");
                return;
            }
            if (new Set(prefixes).size !== prefixes.length) {
                setError("编码前缀不能重复（含品类自身前缀）");
                return;
            }
        }
        setError("");
        createCategory.mutate(
            {
                name: trimmedName,
                codePrefix,
                groups: [],
                ...(hasTypes ? { types: filledTypes } : {}),
            },
            {
                onSuccess: created => {
                    toast.success(
                        hasTypes
                            ? `品类「${created.name}」与 ${created.types?.length ?? 0} 个下属类型已创建，可以开始添加分组`
                            : `品类「${created.name}」已创建，可以开始添加分组`,
                    );
                    onCreated(created);
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
            subtitle="品类即建档时的大类；带下属类型的品类（如跌倒开关）建档时须先选类型。编码前缀防撞号，类型容器永不取号。"
            label="新建品类"
            width={560}
            footer={
                <>
                    <Button size="sm" variant="secondary" onClick={close}>
                        取消
                    </Button>
                    <Button size="sm" onClick={submit} disabled={createCategory.isPending}>
                        创建品类
                    </Button>
                </>
            }
        >
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px]">
                <label className="block">
                    <span className="mb-1 block text-13 font-medium text-td">品类名称 *</span>
                    <input
                        value={name}
                        maxLength={64}
                        placeholder="如：琴键开关"
                        onChange={event => setName(event.target.value)}
                        className="w-full rounded-input border border-line-strong bg-surface px-3 py-2.5 text-14 text-ink outline-none focus:border-primary"
                    />
                </label>
                <label className="block">
                    <span className="mb-1 block text-13 font-medium text-td">编码前缀 *</span>
                    <input
                        value={codePrefix}
                        maxLength={16}
                        placeholder="如：KQ"
                        onChange={event => setCodePrefix(event.target.value.toUpperCase())}
                        className="w-full rounded-input border border-line-strong bg-surface px-3 py-2.5 text-14 text-ink outline-none focus:border-primary"
                    />
                </label>
            </div>
            <p className="mt-1.5 text-13 text-subtle">
                BOM 编码 = 前缀 + 序号；不得与既有前缀构成数字延长冲突（如已有 XK2 时不可用 XK21）
            </p>
            <label className="mt-4 flex items-center gap-2 text-13 text-td">
                <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={hasTypes}
                    onChange={event => setHasTypes(event.target.checked)}
                />
                设置下属类型（创建复合品类，如 新微动 / 老微动）
            </label>
            {hasTypes && (
                <div className="mt-2">
                    <div className="flex flex-col gap-2">
                        {types.map((row, index) => (
                            <div key={index} className="grid grid-cols-[minmax(0,1fr)_128px_32px] items-center gap-2">
                                <input
                                    value={row.name}
                                    maxLength={64}
                                    aria-label={`类型 ${index + 1} 名称`}
                                    placeholder="类型名称（如 新微动）"
                                    onChange={event =>
                                        setTypes(current =>
                                            current.map((item, i) =>
                                                i === index ? { ...item, name: event.target.value } : item,
                                            ),
                                        )
                                    }
                                    className="w-full rounded-input border border-line-strong bg-surface px-3 py-2 text-14 text-ink outline-none focus:border-primary"
                                />
                                <input
                                    value={row.codePrefix}
                                    maxLength={16}
                                    aria-label={`类型 ${index + 1} 编码前缀`}
                                    placeholder="前缀"
                                    onChange={event =>
                                        setTypes(current =>
                                            current.map((item, i) =>
                                                i === index
                                                    ? { ...item, codePrefix: event.target.value.toUpperCase() }
                                                    : item,
                                            ),
                                        )
                                    }
                                    className="w-full rounded-input border border-line-strong bg-surface px-3 py-2 text-14 text-ink outline-none focus:border-primary"
                                />
                                <button
                                    type="button"
                                    aria-label={`删除类型 ${index + 1}`}
                                    disabled={types.length === 1}
                                    onClick={() => setTypes(current => current.filter((_, i) => i !== index))}
                                    className="inline-flex size-8 items-center justify-center rounded-md text-muted transition hover:bg-soft hover:text-ink disabled:cursor-not-allowed disabled:text-placeholder"
                                >
                                    <Icon name="close" size={15} />
                                </button>
                            </div>
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={addRow}
                        className="mt-2.5 flex h-9 w-[calc(100%-40px)] items-center justify-center gap-1.5 rounded-btn border border-dashed border-line bg-panel text-13 text-primary-strong transition hover:border-primary-border hover:bg-primary-soft"
                    >
                        <Icon name="plus" size={14} />
                        添加类型{types.length >= 12 ? "（至多 12 个）" : ""}
                    </button>
                </div>
            )}
            {error && (
                <p role="alert" className="mt-3 text-13 text-danger">
                    {error}
                </p>
            )}
        </Modal>
    );
}
