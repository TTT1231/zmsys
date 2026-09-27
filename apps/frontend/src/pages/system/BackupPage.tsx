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

/** 数据库备份（仅超管）：按业务域勾选（联动补依赖）导出 .sql / .sql.gz */
export function BackupPage() {
    const { can } = useApp();
    const toast = useToast();
    const catalog = useQuery({ queryKey: ["backup-catalog"], queryFn: fetchBackupCatalog });
    const groups = useMemo(() => catalog.data?.groups ?? [], [catalog.data]);
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
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-5 lg:p-7">
            <PageHeading
                eyebrow="系统"
                title="数据库备份"
                description="按业务域导出数据快照（不含建库/建表语句）；备份文件包含用户凭据哈希，请按机密文件保管。"
            />

            <div className="rounded-card border border-warning/40 bg-warning-soft/60 px-4 py-3 text-13 leading-5 text-warning-strong">
                <div className="flex items-start gap-2">
                    <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
                    <span>
                        备份内容包含 sys_user 的口令哈希（bcrypt），泄露等同于泄露全部账号凭据。
                        文件仅限离线保管，不得转发或存放于不受控的位置。
                    </span>
                </div>
            </div>

            <section className="rounded-card border border-line bg-panel p-5">
                <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-14 font-semibold text-ink">备份范围</h3>
                    <label className="flex cursor-pointer items-center gap-1.5 text-13 font-medium text-primary-strong">
                        <input
                            ref={selectAllRef}
                            type="checkbox"
                            className="accent-primary"
                            checked={allChecked}
                            onChange={event => {
                                setSelected(event.target.checked ? new Set(groups.map(group => group.key)) : new Set());
                            }}
                        />
                        全选（完整备份）
                    </label>
                </div>
                {catalog.isLoading ? (
                    <div className="py-6 text-center text-13 text-subtle">正在加载目录…</div>
                ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                        {groups.map(group => (
                            <label
                                key={group.key}
                                className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-surface px-3.5 py-3 transition-colors hover:bg-soft"
                            >
                                <input
                                    type="checkbox"
                                    className="mt-1 accent-primary"
                                    checked={active.has(group.key)}
                                    onChange={event =>
                                        setSelected(applyLinkage(active, group.key, event.target.checked, groups))
                                    }
                                />
                                <span className="min-w-0">
                                    <span className="block text-14 font-medium text-ink">{group.label}</span>
                                    <span
                                        className="block truncate text-12 text-subtle"
                                        title={group.tables.join("、")}
                                    >
                                        {group.tables.length} 张表
                                        {group.dependsOn.length > 0 &&
                                            ` · 联动：${group.dependsOn
                                                .map(dep => groups.find(item => item.key === dep)?.label ?? dep)
                                                .join("、")}`}
                                    </span>
                                </span>
                            </label>
                        ))}
                    </div>
                )}
            </section>

            <section className="rounded-card border border-line bg-panel p-5">
                <Switch checked={gzip} onCheckedChange={setGzip}>
                    <span className="block text-14 font-medium text-ink">gzip 压缩输出（.sql.gz）</span>
                    <span className="block text-12 text-subtle">建议开启；上传恢复时两种格式均支持</span>
                </Switch>
            </section>

            <div className="flex items-center justify-end gap-3">
                <span className="text-13 text-subtle">
                    已选 {active.size}/{groups.length} 组
                    {active.size === groups.length && "（完整备份，可用于整库还原）"}
                </span>
                <Button
                    className="min-h-9 px-4 text-14"
                    disabled={active.size === 0 || backupMutation.isPending}
                    onClick={() => backupMutation.mutate()}
                >
                    {backupMutation.isPending ? "正在备份…" : "执行备份"}
                </Button>
            </div>
        </div>
    );
}
