import { useState } from "react";
import { useNavigate } from "react-router";
import { ROLE_META, useApp } from "@/context/useApp";
import { Icon } from "@/lib/icons";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/toastContexts";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProfileDialog } from "./ProfileDialog";

/* 顶栏用户下拉:菜单内仅保留 姓名 + 角色 两行信息;
   「个人中心」打开资料弹窗,「退出登录」先确认再登出 */
export function UserMenu() {
    const navigate = useNavigate();
    const { user, role, logout } = useApp();
    const toast = useToast();
    const [profileOpen, setProfileOpen] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [loggingOut, setLoggingOut] = useState(false);

    const doLogout = async () => {
        setLoggingOut(true);
        try {
            await logout();
            toast.success("已退出登录");
            navigate("/login", { replace: true });
        } finally {
            setLoggingOut(false);
            setConfirmOpen(false);
        }
    };

    return (
        <>
            {/* 用户下拉不锁页面滚动，避免菜单打开时改变页面宽度。 */}
            <DropdownMenu modal={false}>
                <DropdownMenuTrigger
                    className="flex shrink-0 items-center gap-2.5 rounded-btn px-1.5 py-1 transition hover:bg-soft"
                    aria-label="用户菜单"
                >
                    <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-[var(--color-primary)] to-[var(--color-primary-strong)] text-14 font-semibold text-white">
                        {user?.name.slice(0, 1) ?? "?"}
                        <span className="absolute right-0 bottom-0 h-2.5 w-2.5 rounded-full border-2 border-surface bg-success" />
                    </span>
                    <span className="hidden text-left leading-tight sm:block">
                        <span className="block text-13 font-semibold text-ink">{user?.name ?? "未登录"}</span>
                        <span className="block text-12 text-muted">{ROLE_META[role].roleName}</span>
                    </span>
                    <Icon name="chevron-down" size={14} className="text-muted" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuLabel className="pb-1">
                        <span className="block text-14 font-semibold text-ink">{user?.name ?? "未登录"}</span>
                        <span className="mt-0.5 block text-13 font-normal text-muted">{ROLE_META[role].roleName}</span>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setProfileOpen(true)}>
                        <Icon name="users" size={16} className="text-muted" />
                        个人中心
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        className="text-danger data-highlighted:bg-danger-soft data-highlighted:text-danger"
                        onSelect={() => setConfirmOpen(true)}
                    >
                        <Icon name="logout" size={16} />
                        退出登录
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            {profileOpen && <ProfileDialog onClose={() => setProfileOpen(false)} />}

            <Modal
                open={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                title="退出登录"
                label="账号"
                width={420}
                footer={
                    <>
                        <Button size="sm" variant="secondary" onClick={() => setConfirmOpen(false)}>
                            取消
                        </Button>
                        <Button size="sm" onClick={() => void doLogout()} disabled={loggingOut}>
                            {loggingOut ? "正在退出…" : "退出登录"}
                        </Button>
                    </>
                }
            >
                <p className="text-14 text-td">确定要退出当前账号吗？</p>
            </Modal>
        </>
    );
}
