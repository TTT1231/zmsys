import { useState } from "react";
import { ROLE_META, useApp } from "@/context/AppContext";
import { changePassword, updateProfile } from "@/api";
import { isApiError } from "@/http";
import { Button } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";

/* 个人信息弹窗:账号/角色/状态/最近登录只读(管理员域),姓名可编辑,可自助修改密码。
   姓名保存走 PUT /auth/profile,成功后 refreshProfile 让顶栏与全站即时同步。
   调用方条件挂载(打开即 mount),内部初始值即最新用户数据 */
export function ProfileDialog({ onClose }: { onClose: () => void }) {
    const { user, role, refreshProfile, logout } = useApp();
    const toast = useToast();
    const [name, setName] = useState(user?.name ?? "");
    const [saving, setSaving] = useState(false);
    const [oldPassword, setOldPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [changingPwd, setChangingPwd] = useState(false);

    const save = async () => {
        const next = name.trim();
        if (!next) {
            toast("姓名不能为空", true);
            return;
        }
        if (next === user?.name) {
            onClose();
            return;
        }
        setSaving(true);
        try {
            await updateProfile({ name: next });
            await refreshProfile();
            toast("已保存");
            onClose();
        } catch (error) {
            toast(isApiError(error) ? error.message : "保存失败，请稍后重试", true);
        } finally {
            setSaving(false);
        }
    };

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

    const roRows: Array<[string, string]> = [
        ["账号", `@${user?.account ?? "-"}`],
        ["角色", ROLE_META[role].roleName],
        ["状态", user?.active ? "启用" : "停用"],
        ["最近登录", user?.last ?? "-"],
    ];

    return (
        <Modal
            open
            onClose={onClose}
            title="个人中心"
            subtitle="查看账号信息，姓名可自行修改"
            label="账号"
            width={420}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose}>
                        取消
                    </Button>
                    <Button onClick={() => void save()} disabled={saving}>
                        {saving ? "正在保存…" : "保存"}
                    </Button>
                </>
            }
        >
            <div className="flex items-center gap-3 py-1">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-indigo-600 text-15 font-semibold text-white">
                    {(name.trim() || user?.name || "?").slice(0, 1)}
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
            <div className="mt-4">
                <TextField
                    label="姓名"
                    value={name}
                    onChange={event => setName(event.target.value)}
                    maxLength={20}
                    placeholder="请输入姓名"
                />
            </div>
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
