import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Icon } from "@/lib/icons";
import { Button } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { TableHeaderActions } from "@/components/ui/TableHeaderActions";
import { runBackup, fetchBackupCatalog } from "@/api";
import { useToast } from "@/components/ui/toastContexts";
import { useApp } from "@/context/useApp";
import type { BackupGroupDef } from "@/api";

const GROUP_COPY: Record<string, { title: string; description: string }> = {
    users: { title: "用户与权限", description: "账号、角色与授权记录" },
    customers: { title: "客户档案", description: "客户信息与负责人变更" },
    bom: { title: "物料与 BOM", description: "物料目录与产品清单" },
    orders: { title: "销售订单", description: "订单及其变更记录" },
    inbound: { title: "成品入库", description: "入库记录与库存调整" },
    outbound: { title: "成品出库", description: "发货记录与出库流水" },
    system: { title: "操作记录", description: "系统操作日志" },
};

/** 勾选联动（后端闭包展开的前端镜像）：勾选组自动补齐依赖；取消后净化依赖不全的组（不动点） */
function applyLinkage(selected: Set<string>, key: string, checked: boolean, groups: BackupGroupDef[]): Set<string> {
    const next = new Set(selected);
    if (checked) {
        const visit = (target: string): void => {
            if (next.has(target)) return;
            next.add(target);
            groups.find(group => group.key === target)?.dependsOn.forEach(visit);
        };
        visit(key);
        return next;
    }
    next.delete(key);
    for (;;) {
        let changed = false;
        // Set 迭代中删除未访问项是规范行为（跳过不访问），无需复制快照
        for (const chosen of next) {
            const deps = groups.find(group => group.key === chosen)?.dependsOn ?? [];
            if (deps.some(dep => !next.has(dep))) {
                next.delete(chosen);
                changed = true;
            }
        }
        if (!changed) break;
    }
    return next;
}

/** 编号状态属于内部依赖，不让页面出现仅导出它的无意义选择。 */
function includeInternalData(selected: Set<string>, groups: BackupGroupDef[]): Set<string> {
    if (!groups.some(group => group.key === "sequences")) return selected;
    const next = new Set(selected);
    if (groups.some(group => group.key !== "sequences" && next.has(group.key))) {
        next.add("sequences");
    } else {
        next.delete("sequences");
    }
    return next;
}

/* 格式选择弹窗的两个 radio：配置化生成，避免压缩/未压缩两侧 JSX 镜像 */
const FORMAT_OPTIONS: Array<{
    value: boolean;
    icon: string;
    title: string;
    ext: string;
    description: string;
    badge?: string;
}> = [
    {
        value: true,
        icon: "archive",
        title: "压缩版",
        ext: ".sql.gz",
        description: "文件更小，适合长期保存和传输。",
        badge: "推荐",
    },
    {
        value: false,
        icon: "file",
        title: "未压缩版",
        ext: ".sql",
        description: "纯文本，适合直接查看或手动编辑。",
    },
];

/** 数据库备份（仅超管）：清单面板勾选范围（联动补依赖）→ 弹窗选格式 → 流式下载 .sql / .sql.gz */
export function BackupPage() {
    const { can } = useApp();
    const toast = useToast();
    const catalog = useQuery({ queryKey: ["backup-catalog"], queryFn: fetchBackupCatalog });
    const groups = useMemo(() => catalog.data?.groups ?? [], [catalog.data]);
    const visibleGroups = useMemo(() => groups.filter(group => group.key !== "sequences"), [groups]);
    const visibleKeys = useMemo(() => new Set(visibleGroups.map(group => group.key)), [visibleGroups]);
    // 分组展示名（GROUP_COPY 优先，目录 label 兜底），依赖说明里的组名同样取它
    const groupLabel = useMemo(() => {
        const map = new Map<string, string>();
        for (const group of groups) map.set(group.key, GROUP_COPY[group.key]?.title ?? group.label);
        return map;
    }, [groups]);
    // null = 尚未人工选择：目录加载后默认全选（渲染期派生，避免 effect 内 setState）
    const [selected, setSelected] = useState<Set<string> | null>(null);
    // 人工勾选的分组；null = 未人工选择（等价全部显式）。被勾选但不在 explicit = 依赖闭包自动带出
    const [explicit, setExplicit] = useState<Set<string> | null>(null);
    const active = selected ?? (groups.length > 0 ? new Set(groups.map(group => group.key)) : new Set<string>());
    const explicitSet = explicit ?? new Set(visibleGroups.map(group => group.key));
    const [gzip, setGzip] = useState(true);
    const [formatOpen, setFormatOpen] = useState(false);
    const selectAllRef = useRef<HTMLInputElement>(null);

    const backupMutation = useMutation({
        mutationFn: () => runBackup([...active], gzip),
        onSuccess: async result => {
            const url = URL.createObjectURL(result.data);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = result.fileName;
            anchor.click();
            URL.revokeObjectURL(url);
            toast.success(`备份完成：${result.fileName}`);
        },
        onError: (error: Error) => toast.error(error.message || "备份失败，请稍后重试"),
    });
    const busy = backupMutation.isPending;

    // 备份进行中拦截页面关闭/刷新，避免用户误丢任务（真实库为分钟级耗时）
    useEffect(() => {
        if (!busy) return;
        const guard = (event: BeforeUnloadEvent): void => {
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", guard);
        return () => window.removeEventListener("beforeunload", guard);
    }, [busy]);

    const allChecked = active.size === groups.length && groups.length > 0;
    const visibleSelectedCount = visibleGroups.filter(group => active.has(group.key)).length;
    // indeterminate 属于 DOM 副作用：在 effect 中同步，不在渲染期访问 ref
    useEffect(() => {
        if (selectAllRef.current) {
            selectAllRef.current.indeterminate = active.size > 0 && !allChecked;
        }
    }, [active, allChecked]);

    if (!can("system-backup:run")) {
        return <div className="p-6 text-14 text-subtle">仅超级管理员可访问数据库备份。</div>;
    }

    /** 勾选联动后同步 explicit：新勾的组计为人工选择；explicit 剪除已不在选中集的项 */
    const toggleGroup = (key: string, checked: boolean): void => {
        const next = includeInternalData(applyLinkage(active, key, checked, groups), groups);
        setSelected(next);
        const base = new Set(explicitSet);
        if (checked) base.add(key);
        else base.delete(key);
        setExplicit(new Set([...base].filter(item => next.has(item))));
    };

    const toggleAll = (checked: boolean): void => {
        setSelected(checked ? new Set(groups.map(group => group.key)) : new Set());
        setExplicit(checked ? new Set(visibleGroups.map(group => group.key)) : new Set());
    };

    const startBackup = (): void => {
        setFormatOpen(false);
        backupMutation.mutate();
    };

    return (
        <div className="flex w-full flex-col gap-6 p-5 lg:p-7">
            <section
                className="overflow-hidden rounded-panel border border-line bg-surface shadow-card"
                aria-labelledby="backup-scope-title"
            >
                <div className="flex flex-col gap-4 border-b border-line px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 self-start text-13 font-semibold whitespace-nowrap text-td-strong transition-colors hover:text-primary-strong sm:self-auto">
                        <input
                            ref={selectAllRef}
                            type="checkbox"
                            className="h-4.5 w-4.5 accent-primary"
                            checked={allChecked}
                            disabled={catalog.isLoading || catalog.isError || groups.length === 0 || busy}
                            onChange={event => toggleAll(event.target.checked)}
                        />
                        全部
                    </label>
                    <TableHeaderActions>
                        <Button
                            disabled={busy || visibleSelectedCount === 0 || catalog.isError || groups.length === 0}
                            title={visibleSelectedCount === 0 ? "请先选择要备份的数据组" : undefined}
                            aria-busy={busy || undefined}
                            onClick={() => setFormatOpen(true)}
                        >
                            <Icon
                                name={busy ? "refresh" : "download"}
                                size={16}
                                className={busy ? "animate-spin motion-reduce:animate-none" : undefined}
                            />
                            {busy ? "正在备份…" : "备份"}
                        </Button>
                    </TableHeaderActions>
                </div>
                <div className="p-5 sm:p-6">
                    {catalog.isLoading ? (
                        <div
                            className="flex min-h-48 items-center justify-center gap-2 text-14 text-muted"
                            role="status"
                        >
                            <Icon name="refresh" size={18} className="animate-spin motion-reduce:animate-none" />{" "}
                            正在读取备份目录…
                        </div>
                    ) : catalog.isError ? (
                        <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center">
                            <p className="text-14 text-danger-strong">备份目录加载失败，请重试。</p>
                            <Button variant="secondary" onClick={() => void catalog.refetch()}>
                                重新加载
                            </Button>
                        </div>
                    ) : visibleGroups.length === 0 ? (
                        <div className="py-12 text-center text-14 text-muted">当前没有可备份的数据分组。</div>
                    ) : (
                        <div
                            className={`grid gap-3 sm:grid-cols-2 2xl:grid-cols-3 ${busy ? "pointer-events-none opacity-60" : ""}`}
                        >
                            {visibleGroups.map(group => {
                                const checked = active.has(group.key);
                                const auto = checked && !explicitSet.has(group.key);
                                const copy = GROUP_COPY[group.key];
                                const depLabels = group.dependsOn
                                    .filter(dep => visibleKeys.has(dep))
                                    .map(dep => groupLabel.get(dep) ?? dep);
                                // 描述 · 依赖：… · N 张数据表（原型同款三段式说明）
                                const description = [
                                    copy?.description ?? group.label,
                                    depLabels.length > 0 ? `依赖：${depLabels.join("、")}` : "",
                                    `${group.tables.length} 张数据表`,
                                ]
                                    .filter(Boolean)
                                    .join(" · ");
                                return (
                                    <label
                                        key={group.key}
                                        className={`flex min-h-22 cursor-pointer items-start gap-3 rounded-card border p-3.5 transition-colors focus-within:ring-2 focus-within:ring-primary-border ${checked ? "border-primary-border bg-primary-soft/30 hover:bg-primary-soft/50" : "border-line bg-panel hover:border-line-strong hover:bg-soft"}`}
                                    >
                                        <input
                                            type="checkbox"
                                            className="mt-0.5 h-4.5 w-4.5 shrink-0 accent-primary"
                                            checked={checked}
                                            disabled={busy}
                                            onChange={event => toggleGroup(group.key, event.target.checked)}
                                        />
                                        <span className="min-w-0">
                                            <span className="flex flex-wrap items-center gap-1.5 text-14 font-semibold text-ink">
                                                {copy?.title ?? group.label}
                                                {auto && (
                                                    <span className="inline-flex items-center gap-0.75 rounded-md bg-primary-soft px-1.5 py-0.25 text-11 font-semibold text-primary-strong">
                                                        <Icon name="corner" size={11} strokeWidth={2.4} />
                                                        自动包含
                                                    </span>
                                                )}
                                            </span>
                                            <span className="mt-1 block text-13 leading-5 text-muted">
                                                {description}
                                            </span>
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                    )}
                    {!catalog.isLoading && !catalog.isError && visibleGroups.length > 0 && (
                        <p className="mt-4 flex items-start gap-2 text-13 leading-5 text-muted">
                            <Icon name="info" size={16} className="mt-0.5 shrink-0" />
                            关联的基础数据会自动一同选择或取消。
                        </p>
                    )}
                </div>
            </section>

            <Modal
                open={formatOpen}
                onClose={() => setFormatOpen(false)}
                title="备份"
                subtitle={
                    visibleSelectedCount === visibleGroups.length
                        ? `将备份全部 ${visibleGroups.length} 个数据组`
                        : `将备份 ${visibleSelectedCount} / ${visibleGroups.length} 个数据组`
                }
                width={480}
                footer={
                    <>
                        <Button size="sm" variant="secondary" onClick={() => setFormatOpen(false)}>
                            取消
                        </Button>
                        <Button size="sm" className="min-w-40" disabled={busy} onClick={startBackup}>
                            <Icon name="download" size={16} />
                            开始备份
                        </Button>
                    </>
                }
            >
                <div role="radiogroup" aria-label="文件格式">
                    <p className="mb-2.5 text-14 font-semibold text-ink">文件格式</p>
                    <div className="flex flex-col gap-2.5">
                        {FORMAT_OPTIONS.map(option => {
                            const checked = gzip === option.value;
                            return (
                                <label
                                    key={option.title}
                                    className={`flex min-h-22 cursor-pointer items-center justify-between gap-3 rounded-card border p-3.5 transition-colors focus-within:ring-2 focus-within:ring-primary-border ${checked ? "border-primary bg-primary-soft/40" : "border-line bg-surface hover:border-primary-border hover:bg-soft"}`}
                                >
                                    <input
                                        type="radio"
                                        name="backup-format"
                                        className="sr-only"
                                        checked={checked}
                                        onChange={() => setGzip(option.value)}
                                    />
                                    <span className="min-w-0">
                                        <span className="flex flex-wrap items-center gap-1.5 text-14 font-semibold text-ink">
                                            <Icon
                                                name={option.icon}
                                                size={16}
                                                className={checked ? "text-primary-strong" : "text-muted"}
                                            />
                                            {option.title}
                                            {option.badge && (
                                                <span className="rounded-md bg-primary-soft px-1.5 py-0.25 text-11 font-semibold text-primary-strong">
                                                    {option.badge}
                                                </span>
                                            )}
                                            <span className="font-mono text-12 font-normal text-muted">
                                                {option.ext}
                                            </span>
                                        </span>
                                        <span className="mt-1 block text-12 leading-5 text-muted">
                                            {option.description}
                                        </span>
                                    </span>
                                    <span
                                        aria-hidden="true"
                                        className={`relative block h-4.5 w-4.5 shrink-0 rounded-full border-[1.5px] transition-colors ${checked ? "border-primary" : "border-line-strong"}`}
                                    >
                                        <span
                                            className={`absolute inset-0.75 rounded-full bg-primary transition-transform duration-150 ${checked ? "scale-100" : "scale-0"}`}
                                        />
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                </div>
                <p className="mt-4 flex items-start gap-2 text-12 leading-5 text-muted">
                    <Icon name="info" size={15} className="mt-0.5 shrink-0 text-primary-strong" />
                    备份完成后会自动下载文件；文件包含用户口令哈希等敏感数据，请妥善保管。
                </p>
                {!allChecked && (
                    <p className="mt-2 flex items-start gap-2 text-12 leading-5 text-warning-strong">
                        <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
                        当前为部分备份，仅可用于合并补缺，不能整库还原。
                    </p>
                )}
            </Modal>
        </div>
    );
}
