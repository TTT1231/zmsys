import { type FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { Icon } from "@/lib/icons";
import { useApp } from "@/context/AppContext";
import { isApiError } from "@/http";
import { useToast } from "@/components/ui/Toast";
import loginArt from "./login-art.svg";

/* 登录页：账号密码 → POST /auth/login → 建立会话后进入自己角色的工作台 */
export function LoginPage() {
    const { status, login } = useApp();
    const navigate = useNavigate();
    const toast = useToast();
    const [account, setAccount] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    /* 字段校验首次提交后才开启，开启后随输入实时更新，避免刚进页面就标红 */
    const [validated, setValidated] = useState(false);
    const accountError = validated && !account.trim() ? "请输入账号" : "";
    const passwordError = validated && !password ? "请输入密码" : "";

    if (status === "authenticated") return <Navigate to="/workbench" replace />;

    const onSubmit = async (event: FormEvent) => {
        event.preventDefault();
        if (busy) return;
        setError("");
        setValidated(true);
        if (!account.trim() || !password) return;
        setBusy(true);
        try {
            const user = await login(account.trim(), password);
            toast({
                title: "登录成功",
                message: user?.name ? `欢迎回来，${user.name}` : "欢迎回来",
                tone: "success",
                duration: 4000,
            });
            navigate("/workbench", { replace: true });
        } catch (err) {
            const message = isApiError(err) ? err.message : "登录失败，请稍后重试";
            setError(message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex min-h-dvh flex-col bg-canvas lg:grid lg:grid-cols-[1.05fr_1fr]">
            {/* 品牌区：移动端为顶部渐变横幅，桌面端为左侧全高面板；只留品牌标识 + 装饰插画，不放营销文案 */}
            <aside className="relative overflow-hidden bg-gradient-to-br from-indigo-700 via-indigo-600 to-sky-500 px-6 pt-[max(3rem,env(safe-area-inset-top))] pb-20 lg:flex lg:flex-col lg:px-14 lg:py-12">
                {/* 网格纹理与光斑、圆环装饰 */}
                <div
                    className="absolute inset-0"
                    style={{
                        backgroundImage:
                            "linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px)",
                        backgroundSize: "46px 46px",
                    }}
                    aria-hidden="true"
                />
                <div
                    className="absolute -top-24 -right-20 h-72 w-72 rounded-full bg-sky-300/30 blur-3xl"
                    aria-hidden="true"
                />
                <div
                    className="absolute -left-16 bottom-10 h-64 w-64 animate-float rounded-full bg-indigo-300/25 blur-3xl"
                    aria-hidden="true"
                />
                <div
                    className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full border border-white/10"
                    aria-hidden="true"
                />
                <div
                    className="absolute -bottom-20 -right-20 h-64 w-64 rounded-full border border-white/15"
                    aria-hidden="true"
                />

                {/* 品牌标识（移动端 + 桌面端共用） */}
                <div className="relative flex items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/25 bg-white/15 text-white backdrop-blur-sm">
                        <Icon name="brand" size={22} />
                    </span>
                    <div className="leading-tight">
                        <div className="text-17 font-semibold text-white">智造管理系统</div>
                        <div className="text-12 text-indigo-100">订单驱动的成品仓库管理</div>
                    </div>
                </div>

                {/* 装饰插画：订单单据 → 勾选 → 成品箱堆叠的等距线条画 */}
                <img
                    src={loginArt}
                    alt=""
                    aria-hidden="true"
                    className="relative mx-auto mt-8 w-52 animate-float lg:hidden"
                />
                <div className="relative hidden flex-1 items-center justify-center lg:flex">
                    <img src={loginArt} alt="" aria-hidden="true" className="w-full max-w-105 animate-float" />
                </div>
            </aside>

            {/* 表单区：移动端卡片上浮叠在横幅上，桌面端垂直居中 */}
            <main className="relative flex flex-1 justify-center px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] lg:items-center lg:px-10">
                <div className="-mt-14 w-full max-w-105 animate-rise lg:mt-0">
                    <div className="rounded-panel border border-line bg-white p-6 shadow-modal sm:p-8 lg:shadow-card">
                        <div className="mb-7">
                            <h2 className="text-22 font-semibold text-ink">欢迎回来</h2>
                            <p className="mt-1 text-13 text-muted">登录您的账号以继续</p>
                        </div>

                        <form onSubmit={onSubmit} className="flex flex-col gap-4.5" noValidate>
                            <label className="block">
                                <span className="mb-1.5 block text-13 font-medium text-ink">账号</span>
                                <div className="group relative">
                                    <Icon
                                        name="user"
                                        size={18}
                                        className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-subtle transition-colors group-focus-within:text-primary"
                                    />
                                    <input
                                        className={`h-12 w-full rounded-input bg-soft pr-3 pl-10 text-14 text-ink transition-all placeholder:text-subtle/70 focus:bg-white focus:ring-4 focus:outline-none ${
                                            accountError
                                                ? "border-danger focus:border-danger focus:ring-danger/10"
                                                : "border-line focus:border-primary focus:ring-primary/10"
                                        }`}
                                        autoComplete="username"
                                        aria-invalid={accountError ? true : undefined}
                                        aria-describedby={accountError ? "login-account-error" : undefined}
                                        placeholder="请输入账号"
                                        value={account}
                                        onChange={event => {
                                            setAccount(event.target.value);
                                            setError("");
                                        }}
                                    />
                                </div>
                                {/* 每个字段预留一行提示位，提示出现/消失时布局不挤动 */}
                                <p
                                    id="login-account-error"
                                    className="mt-1.5 flex min-h-5 items-start text-12.5 leading-5 text-danger"
                                >
                                    {accountError}
                                </p>
                            </label>

                            <label className="block">
                                <span className="mb-1.5 block text-13 font-medium text-ink">密码</span>
                                <div className="group relative">
                                    <Icon
                                        name="lock"
                                        size={18}
                                        className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-subtle transition-colors group-focus-within:text-primary"
                                    />
                                    <input
                                        className={`h-12 w-full rounded-input bg-soft pr-11 pl-10 text-14 text-ink transition-all placeholder:text-subtle/70 focus:bg-white focus:ring-4 focus:outline-none ${
                                            passwordError
                                                ? "border-danger focus:border-danger focus:ring-danger/10"
                                                : "border-line focus:border-primary focus:ring-primary/10"
                                        }`}
                                        type={showPassword ? "text" : "password"}
                                        autoComplete="current-password"
                                        aria-invalid={passwordError ? true : undefined}
                                        aria-describedby={passwordError ? "login-password-error" : undefined}
                                        placeholder="请输入密码"
                                        value={password}
                                        onChange={event => {
                                            setPassword(event.target.value);
                                            setError("");
                                        }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(value => !value)}
                                        aria-label={showPassword ? "隐藏密码" : "显示密码"}
                                        aria-pressed={showPassword}
                                        className="absolute top-1/2 right-2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-subtle transition-colors hover:bg-line/40 hover:text-ink"
                                    >
                                        <Icon name={showPassword ? "eye-off" : "eye"} size={17} />
                                    </button>
                                </div>
                                <p
                                    id="login-password-error"
                                    className="mt-1.5 flex min-h-5 items-start text-12.5 leading-5 text-danger"
                                >
                                    {passwordError}
                                </p>
                            </label>

                            <div>
                                {/* 始终保留两行反馈空间，校验和请求状态切换时不挤动表单。 */}
                                <p
                                    id="login-error"
                                    role="alert"
                                    aria-atomic="true"
                                    className={`flex h-10 items-start gap-2 overflow-y-auto text-12.5 leading-5 text-danger transition-opacity duration-150 motion-reduce:transition-none ${error ? "opacity-100" : "opacity-0"}`}
                                >
                                    {error && (
                                        <>
                                            <Icon
                                                name="alert"
                                                size={15}
                                                className="mt-0.5 shrink-0"
                                                aria-hidden="true"
                                            />
                                            <span className="min-w-0 wrap-anywhere">{error}</span>
                                        </>
                                    )}
                                </p>

                                <button
                                    type="submit"
                                    disabled={busy}
                                    className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-btn bg-gradient-to-r from-indigo-600 to-indigo-500 text-15 font-semibold text-white shadow-glow transition-all hover:from-indigo-700 hover:to-indigo-600 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-70"
                                >
                                    {busy && (
                                        <span
                                            className="h-4.5 w-4.5 animate-spin rounded-full border-2 border-white/35 border-t-white"
                                            aria-hidden="true"
                                        />
                                    )}
                                    {busy ? "登录中…" : "登录"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </main>
        </div>
    );
}
