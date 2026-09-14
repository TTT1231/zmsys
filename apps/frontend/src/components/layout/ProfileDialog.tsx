import { useState, type ReactNode } from "react";
import { ROLE_META, useApp } from "@/context/AppContext";
import { changePassword } from "@/api";
import { formatDateTime } from "@/lib/date";
import { isApiError } from "@/http";
import { Button } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";

/* 个人信息弹窗:全部信息只读(账号/姓名/角色/状态均为管理员域),仅可自助修改密码。
   姓名修改走用户权限页的管理员编辑,此处不再提供自助改名入口 */
export function ProfileDialog({ onClose }: { onClose: () => void }) {
    const { user, role, logout } = useApp();
    const toast = useToast();
    const [oldPassword, setOldPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [changingPwd, setChangingPwd] = useState(false);

    const submitPassword = async () => {
        if (!oldPassword || !newPassword) {
            toast("请输入旧密码与新密码", true);
            return;
        }
        if (newPassword.length < 6) {
            toast("新密码至少 6 位", true);
            return;
        }
        if (newPassword !== confirmPassword) {
            toast("两次输入的新密码不一致", true);
            return;
        }
        setChangingPwd(true);
        try {
            await changePassword({ oldPassword, newPassword });
            toast("密码已修改，请重新登录");
            await logout();
        } catch (error) {
            toast(isApiError(error) ? error.message : "密码修改失败，请稍后重试", true);
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

    const roRows: Array<[string, ReactNode]> = [
        ["账号", `@${user?.account ?? "-"}`],
        ["姓名", user?.name ?? "-"],
        ["角色", ROLE_META[role].roleName],
        ["状态", activeNode],
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
            width={420}
            footer={
                <Button variant="secondary" onClick={onClose}>
                    关闭
                </Button>
            }
        >
            <div className="flex items-center gap-3 py-1">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-indigo-600 text-15 font-semibold text-white">
                    {(user?.name ?? "?").slice(0, 1)}
                </span>
                <div className="min-w-0">
                    <div className="truncate text-15 font-semibold text-ink">{user?.name ?? "未登录"}</div>
                    <div className="text-12 text-muted">{ROLE_META[role].roleName}</div>
                </div>
            </div>
            <dl className="mt-3 divide-y divide-dashed divide-line rounded-card border border-line bg-panel">
                {roRows.map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between gap-4 px-4 py-2.5 text-13">
                        <dt className="text-muted">{key}</dt>
                        <dd className="font-medium text-ink">{value}</dd>
                    </div>
                ))}
            </dl>
            <div className="mt-4 border-t border-dashed border-line pt-4">
                <p className="text-12.5 font-semibold text-ink">修改密码</p>
                <div className="mt-2 flex flex-col gap-2.5">
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
                        className="self-start"
                    >
                        {changingPwd ? "正在修改…" : "修改密码"}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
