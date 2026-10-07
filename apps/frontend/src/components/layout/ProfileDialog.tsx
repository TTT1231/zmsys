import { useState, type ReactNode } from "react";
import { ROLE_META, useApp } from "@/context/useApp";
import { changePassword } from "@/api";
import { formatDateTime } from "@/lib/date";
import { isApiError } from "@/http";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/toastContexts";

/* 个人信息弹窗:全部信息只读(账号/姓名/角色/状态均为管理员域),仅可自助修改密码。
   姓名修改走用户权限页的管理员编辑,此处不再提供自助改名入口。
   布局:md 起左右双卡——左卡身份头(姓名/角色/状态)+ 只读信息,右卡改密表单,
   单列细条在大屏上比例失调;窄屏自动叠回单列 */
export function ProfileDialog({ onClose }: { onClose: () => void }) {
    const { user, role, logout } = useApp();
    const toast = useToast();
    const [oldPassword, setOldPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [changingPwd, setChangingPwd] = useState(false);

    const submitPassword = async () => {
        if (!oldPassword || !newPassword) {
            toast.error("请输入旧密码与新密码");
            return;
        }
        if (newPassword.length < 6) {
            toast.error("新密码至少 6 位");
            return;
        }
        if (newPassword !== confirmPassword) {
            toast.error("两次输入的新密码不一致");
            return;
        }
        setChangingPwd(true);
        try {
            await changePassword({ oldPassword, newPassword });
            toast.success("密码已修改，请重新登录");
            await logout();
        } catch (error) {
            toast.error(isApiError(error) ? error.message : "密码修改失败，请稍后重试");
        } finally {
            setChangingPwd(false);
        }
    };

    /* 状态点：绿色=启用（与用户管理页 Badge 同一 status token）；停用为中性灰（登录态下几乎不可见，兜底展示） */
    const activeNode = (
        <span className={`inline-flex items-center gap-1.5 ${user?.active ? "text-success" : "text-muted"}`}>
            <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${user?.active ? "bg-success" : "bg-muted"}`}
            />
            {user?.active ? "启用" : "已停用"}
        </span>
    );

    /* 姓名/角色/状态在左卡身份头展示，列表不再重复这三行 */
    const roRows: Array<[string, ReactNode]> = [
        ["账号", `@${user?.account ?? "-"}`],
        ["最近登录", user?.last ?? "-"],
        ["创建时间", user?.createdAt ? formatDateTime(user.createdAt) : "-"],
        ["上一次修改时间", user?.updatedAt ? formatDateTime(user.updatedAt) : "—"],
    ];

    return (
        <Modal
            open
            onClose={onClose}
            title="个人中心"
            subtitle="查看账号信息，姓名如需修改请联系管理员"
            label="账号"
            width={680}
            footer={
                <Button size="sm" variant="secondary" onClick={onClose}>
                    关闭
                </Button>
            }
        >
            <div className="grid items-stretch gap-4 md:grid-cols-2">
                <section className="rounded-card border border-line bg-panel p-4">
                    <div className="flex items-center gap-3">
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-[var(--color-primary)] to-[var(--color-primary-strong)] text-17 font-semibold text-white">
                            {(user?.name ?? "?").slice(0, 1)}
                        </span>
                        <div className="min-w-0">
                            <div className="truncate text-16 font-semibold text-ink">{user?.name ?? "未登录"}</div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-13 text-muted">
                                <span>{ROLE_META[role].roleName}</span>
                                {activeNode}
                            </div>
                        </div>
                    </div>
                    <dl className="mt-3 divide-y divide-dashed divide-line border-t border-dashed border-line">
                        {roRows.map(([key, value]) => (
                            <div key={key} className="flex items-center justify-between gap-4 py-2.5 text-14">
                                <dt className="shrink-0 text-muted">{key}</dt>
                                <dd className="min-w-0 truncate text-right font-medium text-ink">{value}</dd>
                            </div>
                        ))}
                    </dl>
                </section>
                <section className="rounded-card border border-line bg-panel p-4">
                    <h3 className="text-13 font-semibold text-ink">修改密码</h3>
                    <div className="mt-2.5 flex flex-col gap-2.5">
                        <TextField
                            label="旧密码"
                            type="password"
                            autoComplete="current-password"
                            value={oldPassword}
                            onChange={event => setOldPassword(event.target.value)}
                        />
                        <TextField
                            label="新密码（至少 6 位）"
                            type="password"
                            autoComplete="new-password"
                            value={newPassword}
                            onChange={event => setNewPassword(event.target.value)}
                        />
                        <TextField
                            label="确认新密码"
                            type="password"
                            autoComplete="new-password"
                            value={confirmPassword}
                            onChange={event => setConfirmPassword(event.target.value)}
                        />
                        <Button
                            variant="secondary"
                            disabled={changingPwd}
                            onClick={() => void submitPassword()}
                            className="mt-1 self-start"
                        >
                            {changingPwd ? "正在修改…" : "修改密码"}
                        </Button>
                    </div>
                </section>
            </div>
        </Modal>
    );
}
