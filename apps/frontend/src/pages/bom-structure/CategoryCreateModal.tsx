import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Icon } from "@/lib/icons";

/** 新建品类弹窗的产物：本地草稿（不落库），保存结构时才随整棵树一次性入库 */
export interface NewCategoryDraftInput {
    name: string;
    codePrefix: string;
    types: Array<{ name: string; codePrefix: string }>;
}

/**
 * 新建品类（BOM结构原型.html 交互）：名称 + 编码开头，可选「再分几种类型」——
 * 提交只生成左侧导航里的本地草稿品类（未入库），右侧搭建结构后点「保存结构」
 * 才调 createBomCategory 连品类带整棵树一次写入；中途放弃直接丢弃，无残留。
 */
export function CategoryCreateModal({
    open,
    onClose,
    onDraft,
}: {
    open: boolean;
    onClose: () => void;
    /** 提交草稿：页面据此在品类面板追加草稿品类并切换选中 */
    onDraft: (draft: NewCategoryDraftInput) => void;
}) {
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
            setError(codePrefix ? "编号开头只能填字母或数字" : "请填写编号开头");
            return;
        }
        if (hasTypes) {
            if (filledTypes.some(row => !row.name || !row.codePrefix)) {
                setError("还有类型没填完整");
                return;
            }
            const names = [trimmedName, ...filledTypes.map(row => row.name)];
            if (new Set(names).size !== names.length) {
                setError("品类和类型的名称不能重复");
                return;
            }
            const prefixes = [codePrefix, ...filledTypes.map(row => row.codePrefix)];
            if (filledTypes.some(row => !/^[A-Z0-9]{1,16}$/.test(row.codePrefix))) {
                setError("类型代号只能填字母或数字");
                return;
            }
            if (new Set(prefixes).size !== prefixes.length) {
                setError("编号开头和类型代号不能重复");
                return;
            }
        }
        setError("");
        onDraft({ name: trimmedName, codePrefix, types: filledTypes });
        close();
    };

    return (
        <Modal
            open={open}
            onClose={close}
            title="新建品类"
            width={480}
            footer={
                <>
                    <Button size="sm" variant="secondary" onClick={close}>
                        取消
                    </Button>
                    <Button size="sm" onClick={submit}>
                        创建品类
                    </Button>
                </>
            }
        >
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_132px]">
                <label className="block">
                    <span className="mb-1 block text-13 font-medium text-td">品类名称 *</span>
                    <input
                        value={name}
                        aria-required="true"
                        maxLength={64}
                        placeholder="如：琴键开关"
                        onChange={event => {
                            setName(event.target.value);
                            setError("");
                        }}
                        className="w-full rounded-input border border-line-strong bg-surface px-3 py-2.5 text-14 text-ink outline-none focus:border-primary"
                    />
                </label>
                <label className="block">
                    <span className="mb-1 block text-13 font-medium text-td">编号开头 *</span>
                    <input
                        value={codePrefix}
                        aria-required="true"
                        maxLength={16}
                        placeholder="如：KQ"
                        onChange={event => {
                            setCodePrefix(event.target.value.toUpperCase());
                            setError("");
                        }}
                        className="w-full rounded-input border border-line-strong bg-surface px-3 py-2.5 text-14 text-ink outline-none focus:border-primary"
                    />
                </label>
            </div>
            <p className="mt-2 text-12 text-muted">
                编号示例：<span className="tnum font-medium text-ink">{codePrefix || "KQ"}001</span>
            </p>
            <label className="mt-4 flex min-h-9 cursor-pointer items-center gap-2 text-13 text-td">
                <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={hasTypes}
                    onChange={event => {
                        setHasTypes(event.target.checked);
                        setError("");
                    }}
                />
                再分几种类型
            </label>
            {hasTypes && (
                <div className="mt-2">
                    <div
                        className="mb-1 grid grid-cols-[minmax(0,1fr)_104px_32px] gap-2 text-12 text-muted"
                        aria-hidden="true"
                    >
                        <span>类型名称</span>
                        <span>类型代号</span>
                    </div>
                    <div className="flex flex-col gap-2">
                        {types.map((row, index) => (
                            <div key={index} className="grid grid-cols-[minmax(0,1fr)_104px_32px] items-center gap-2">
                                <input
                                    value={row.name}
                                    maxLength={64}
                                    aria-label={`类型 ${index + 1} 名称`}
                                    placeholder="如：新微动"
                                    onChange={event => {
                                        setTypes(current =>
                                            current.map((item, i) =>
                                                i === index ? { ...item, name: event.target.value } : item,
                                            ),
                                        );
                                        setError("");
                                    }}
                                    className="w-full rounded-input border border-line-strong bg-surface px-3 py-2 text-14 text-ink outline-none focus:border-primary"
                                />
                                <input
                                    value={row.codePrefix}
                                    maxLength={16}
                                    aria-label={`类型 ${index + 1} 代号`}
                                    placeholder="如：KQN"
                                    onChange={event => {
                                        setTypes(current =>
                                            current.map((item, i) =>
                                                i === index
                                                    ? { ...item, codePrefix: event.target.value.toUpperCase() }
                                                    : item,
                                            ),
                                        );
                                        setError("");
                                    }}
                                    className="w-full rounded-input border border-line-strong bg-surface px-3 py-2 text-14 text-ink outline-none focus:border-primary"
                                />
                                <button
                                    type="button"
                                    aria-label={`删除类型 ${index + 1}`}
                                    disabled={types.length === 1}
                                    onClick={() => {
                                        setTypes(current => current.filter((_, i) => i !== index));
                                        setError("");
                                    }}
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
                        disabled={types.length >= 12}
                        title={types.length >= 12 ? "最多 12 种类型" : undefined}
                        className="mt-2.5 flex h-9 w-[calc(100%-40px)] items-center justify-center gap-1.5 rounded-btn border border-dashed border-line bg-panel text-13 text-primary-strong transition hover:border-primary-border hover:bg-primary-soft disabled:cursor-not-allowed disabled:text-placeholder"
                    >
                        <Icon name="plus" size={14} />
                        添加类型
                    </button>
                </div>
            )}
            {error && (
                <p role="alert" className="mt-3 text-13 text-danger">
                    {error}
                </p>
            )}
            <p className="mt-4 text-12 text-subtle">创建后先在右侧搭建结构，点「保存结构」才会写入数据库。</p>
        </Modal>
    );
}
