import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Icon } from "@/lib/icons";
import { Button } from "@/components/ui/Badge";
import { PageHeading } from "@/components/ui/PageHeading";
import { Switch } from "@/components/ui/Switch";
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

/** 数据库备份（仅超管）：按业务域勾选（联动补依赖）导出 .sql / .sql.gz */
export function BackupPage() {
    const { can } = useApp();
    const toast = useToast();
    const catalog = useQuery({ queryKey: ["backup-catalog"], queryFn: fetchBackupCatalog });
    const groups = useMemo(() => catalog.data?.groups ?? [], [catalog.data]);
    const visibleGroups = useMemo(() => groups.filter(group => group.key !== "sequences"), [groups]);
    // null = 尚未人工选择：目录加载后默认全选（渲染期派生，避免 effect 内 setState）
    const [selected, setSelected] = useState<Set<string> | null>(null);
    const active = selected ?? (groups.length > 0 ? new Set(groups.map(group => group.key)) : new Set<string>());
    const [gzip, setGzip] = useState(true);
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
            toast(`备份已生成：${result.fileName}`);
        },
        onError: (error: Error) => toast(error.message || "备份失败", true),
    });

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

    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-5 lg:p-7">
            <PageHeading title="数据备份" description="选择备份范围，生成并下载数据快照。默认包含全部业务数据。" />

            <div className="grid items-start gap-5 lg:grid-cols-3">
                <section
                    className="overflow-hidden rounded-panel border border-line bg-surface shadow-card lg:col-span-2"
                    aria-labelledby="backup-scope-title"
                >
                    <div className="flex flex-col gap-4 border-b border-line px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
                        <div>
                            <div className="flex items-center gap-3">
                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-strong">
                                    <Icon name="database" size={20} />
                                </span>
                                <div>
                                    <h2 id="backup-scope-title" className="text-17 font-semibold text-ink">
                                        选择备份内容
                                    </h2>
                                    <p className="text-13 text-muted">按业务范围选择需要留存的数据。</p>
                                </div>
                            </div>
                        </div>
                        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-btn border border-line bg-soft px-3 text-13 font-medium text-td-strong hover:border-primary-border">
                            <input
                                ref={selectAllRef}
                                type="checkbox"
                                className="h-4 w-4 accent-primary"
                                checked={allChecked}
                                disabled={catalog.isLoading || catalog.isError || groups.length === 0}
                                onChange={event =>
                                    setSelected(
                                        event.target.checked ? new Set(groups.map(group => group.key)) : new Set(),
                                    )
                                }
                            />
                            选择全部业务数据
                        </label>
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
                            <div className="grid gap-3 sm:grid-cols-2">
                                {visibleGroups.map(group => {
                                    const checked = active.has(group.key);
                                    return (
                                        <label
                                            key={group.key}
                                            className={`flex min-h-18 cursor-pointer items-start gap-3 rounded-card border p-3.5 transition-colors focus-within:ring-2 focus-within:ring-primary-border ${checked ? "border-primary-border bg-surface" : "border-line bg-panel hover:border-line-strong hover:bg-soft"}`}
                                        >
                                            <input
                                                type="checkbox"
                                                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                                                checked={checked}
                                                onChange={event =>
                                                    setSelected(
                                                        includeInternalData(
                                                            applyLinkage(
                                                                active,
                                                                group.key,
                                                                event.target.checked,
                                                                groups,
                                                            ),
                                                            groups,
                                                        ),
                                                    )
                                                }
                                            />
                                            <span className="min-w-0">
                                                <span className="block text-14 font-semibold text-ink">
                                                    {GROUP_COPY[group.key]?.title ?? group.label}
                                                </span>
                                                <span className="mt-1 block text-13 text-muted">
                                                    {GROUP_COPY[group.key]?.description ??
                                                        `${group.tables.length} 张数据表`}
                                                </span>
                                            </span>
                                        </label>
                                    );
                                })}
                            </div>
                        )}
                        <p className="mt-4 flex items-start gap-2 text-13 leading-5 text-muted">
                            <Icon name="info" size={16} className="mt-0.5 shrink-0" />
                            关联的基础数据会自动一同选择或取消。
                        </p>
                    </div>
                </section>

                <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
                    <section
                        className="rounded-panel border border-line bg-surface p-5 shadow-card"
                        aria-labelledby="backup-summary-title"
                    >
                        <div className="flex items-center justify-between gap-3">
                            <h2 id="backup-summary-title" className="text-16 font-semibold text-ink">
                                导出摘要
                            </h2>
                            <span
                                className={`rounded-full px-2.5 py-1 text-12 font-medium ${allChecked ? "bg-success-soft text-success" : "bg-soft text-td-strong"}`}
                            >
                                {allChecked ? "完整备份" : "自定义范围"}
                            </span>
                        </div>
                        <div className="mt-5 rounded-card bg-soft p-4">
                            <div className="text-12 text-muted">已选择的内容</div>
                            <div className="mt-1 text-20 font-semibold tabular-nums text-ink">
                                {visibleSelectedCount}
                                <span className="ml-1 text-13 font-normal text-muted">/ {visibleGroups.length} 项</span>
                            </div>
                        </div>
                        <div className="mt-5 border-t border-line pt-4">
                            <Switch checked={gzip} onCheckedChange={setGzip}>
                                <span className="block text-14 font-medium text-ink">压缩备份文件</span>
                                <span className="block text-12 text-muted">
                                    {gzip ? ".sql.gz，文件更小" : ".sql，未压缩"}
                                </span>
                            </Switch>
                        </div>
                        <p className="mt-4 text-13 leading-5 text-muted">
                            {allChecked
                                ? "完整备份可用于合并补缺或整库还原。"
                                : "部分备份仅可用于合并补缺，不能整库还原。"}
                        </p>
                        <Button
                            icon={backupMutation.isPending ? "refresh" : "download"}
                            className="mt-5 w-full"
                            disabled={visibleSelectedCount === 0 || catalog.isError || backupMutation.isPending}
                            onClick={() => backupMutation.mutate()}
                        >
                            {backupMutation.isPending ? "正在生成备份…" : "生成并下载备份"}
                        </Button>
                    </section>

                    <section
                        className="rounded-card border border-warning/30 bg-warning-soft p-4"
                        aria-labelledby="backup-security-title"
                    >
                        <div className="flex items-start gap-3">
                            <Icon name="shield" size={19} className="mt-0.5 shrink-0 text-warning-strong" />
                            <div>
                                <h2 id="backup-security-title" className="text-14 font-semibold text-warning-strong">
                                    妥善保管下载文件
                                </h2>
                                <p className="mt-1 text-13 leading-5 text-warning-strong">
                                    文件包含用户密码哈希等敏感数据。请仅存放在受控位置，不要转发或上传到公开网盘。
                                </p>
                            </div>
                        </div>
                    </section>
                </aside>
            </div>
        </div>
    );
}
