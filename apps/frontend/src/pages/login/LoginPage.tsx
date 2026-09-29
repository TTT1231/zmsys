import { type FormEvent, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { Icon } from "@/lib/icons";
import { BrandLogo } from "@/components/BrandLogo";
import { useApp } from "@/context/useApp";
import { isApiError } from "@/http";
import { useNotification, useToast } from "@/components/ui/toastContexts";
import { SliderCaptcha } from "./SliderCaptcha";
import loginArt from "./login-art.svg";

function loginErrorMessage(error: unknown) {
    if (!isApiError(error)) return "登录服务暂时不可用，请稍后重试";
    if (error.code === -1) return "无法连接登录服务，请检查网络后重试";
    if (error.code === 408) return "登录请求超时，请稍后重试";
    if (error.code === 429) return "尝试次数过多，请稍后再试";
    if (error.code >= 500) return "登录服务暂时不可用，请稍后重试";
    return error.message || "登录失败，请重试";
}

/* vben 同款键名：记住的账号按 hostname 隔离，避免多环境互相污染 */
export const REMEMBER_KEY = `REMEMBER_ME_USERNAME_${location.hostname}`;

/* vben 式输入框：无标签、左侧行内图标、聚焦时边框 + 1px 内描边（inset-ring） */
function fieldClass(invalid: string | boolean, extra = "") {
    return `h-10 w-full rounded-md border bg-surface pl-10 text-14 text-ink transition-colors placeholder:text-placeholder focus:outline-none ${
        invalid
            ? "border-danger focus:inset-ring-1 focus:inset-ring-danger"
            : "border-line focus:border-primary focus:inset-ring-1 focus:inset-ring-primary"
    } ${extra}`;
}

/* 登录页：账号密码 + 滑块验证 → POST /auth/login → 建立会话后进入自己角色的工作台 */
export function LoginPage() {
    const { status, login } = useApp();
    const navigate = useNavigate();
    const toast = useToast();
    const notify = useNotification();
    /* 登录 / 忘记密码两个视图（vben 式同面板切换）；表单状态全挂父级，切视图不丢已输入内容 */
    const [view, setView] = useState<"forget" | "login">("login");
    const rememberedAccount = localStorage.getItem(REMEMBER_KEY) ?? "";
    const [account, setAccount] = useState(rememberedAccount);
    const [password, setPassword] = useState("");
    const [remember, setRemember] = useState(Boolean(rememberedAccount));
    const [captchaPassed, setCaptchaPassed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const accountInputRef = useRef<HTMLInputElement>(null);
    const passwordInputRef = useRef<HTMLInputElement>(null);
    /* 字段校验首次提交后才开启，开启后随输入实时更新，避免刚进页面就标红 */
    const [validated, setValidated] = useState(false);
    const accountError = validated && !account.trim() ? "请输入账号" : "";
    const passwordError = validated && !password ? "请输入密码" : "";
    const captchaError = validated && !captchaPassed ? "请拖动滑块完成验证" : "";
    /* 忘记密码：系统无自助重置通道（重置由管理员在「用户管理」执行），提交后给出指引 */
    const [forgetAccount, setForgetAccount] = useState("");
    const [forgetValidated, setForgetValidated] = useState(false);
    const forgetAccountError = forgetValidated && !forgetAccount.trim() ? "请输入账号" : "";

    if (status === "authenticated") return <Navigate to="/workbench" replace />;

    const onSubmit = async (event: FormEvent) => {
        event.preventDefault();
        if (busy) return;
        setValidated(true);
        if (!account.trim() || !password || !captchaPassed) {
            if (!account.trim()) accountInputRef.current?.focus();
            else if (!password) passwordInputRef.current?.focus();
            return;
        }
        /* vben 同款：校验通过即落盘（勾选存账号、取消存空串），下次进入自动回填 */
        localStorage.setItem(REMEMBER_KEY, remember ? account.trim() : "");
        setBusy(true);
        try {
            const user = await login(account.trim(), password);
            notify({ title: "登录成功", message: user?.name ? `欢迎回来，${user.name}` : "欢迎回来" });
            navigate("/workbench", { replace: true });
        } catch (err) {
            toast(loginErrorMessage(err), true);
            /* vben 同款：登录失败重置滑块，要求重新验证 */
            setCaptchaPassed(false);
        } finally {
            setBusy(false);
        }
    };

    const onForgetSubmit = (event: FormEvent) => {
        event.preventDefault();
        setForgetValidated(true);
        if (!forgetAccount.trim()) return;
        notify({
            title: "请联系管理员重置密码",
            message: `账号 ${forgetAccount.trim()} 的密码需由系统管理员在「用户管理」中重置后生效`,
        });
    };

    return (
        <div className="flex min-h-dvh flex-col bg-canvas lg:grid lg:grid-cols-[1.05fr_1fr]">
            {/* 品牌区：移动端为顶部渐变横幅，桌面端为左侧全高面板；只留品牌标识 + 装饰插画，不放营销文案 */}
            <aside className="relative overflow-hidden bg-linear-to-br from-indigo-700 via-indigo-600 to-sky-500 px-6 pt-[max(3rem,env(safe-area-inset-top))] pb-10 lg:flex lg:flex-col lg:px-14 lg:py-12">
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
                    <BrandLogo decorative className="size-11" />
                    <div className="leading-tight">
                        <div className="text-17 font-semibold text-white">众茂生产系统</div>
                        <div className="text-13 text-indigo-100">订单驱动的成品仓库管理</div>
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

            {/* 表单区：vben 式平铺面板（无卡片），移动端顺接横幅下方，桌面端垂直居中 */}
            <main className="relative flex flex-1 justify-center bg-surface px-6 pt-10 pb-[max(2.5rem,env(safe-area-inset-bottom))] lg:items-center lg:px-8 lg:py-10">
                <div key={view} className="w-full max-w-md animate-rise">
                    {view === "login" ? (
                        <>
                            <div className="mb-7">
                                <h2 className="text-3xl/9 font-bold tracking-tight text-ink lg:text-4xl">
                                    欢迎回来 👋🏻
                                </h2>
                                <p className="mt-1 text-14 text-muted lg:text-15">
                                    请输入您的账户信息以开始管理您的项目
                                </p>
                            </div>

                            <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
                                <div>
                                    <div className="group relative">
                                        <Icon
                                            name="user"
                                            size={18}
                                            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-subtle transition-colors group-focus-within:text-primary"
                                        />
                                        <input
                                            ref={accountInputRef}
                                            id="login-account"
                                            aria-label="账号"
                                            className={fieldClass(accountError)}
                                            autoComplete="username"
                                            disabled={busy}
                                            aria-invalid={accountError ? true : undefined}
                                            aria-describedby={accountError ? "login-account-error" : undefined}
                                            placeholder="请输入账号"
                                            value={account}
                                            onChange={event => setAccount(event.target.value)}
                                        />
                                    </div>
                                    {accountError && (
                                        <p id="login-account-error" className="mt-1.5 text-13 leading-5 text-danger">
                                            {accountError}
                                        </p>
                                    )}
                                </div>

                                <div>
                                    <div className="group relative">
                                        <Icon
                                            name="lock"
                                            size={18}
                                            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-subtle transition-colors group-focus-within:text-primary"
                                        />
                                        <input
                                            ref={passwordInputRef}
                                            id="login-password"
                                            aria-label="密码"
                                            className={fieldClass(passwordError, "pr-11")}
                                            type={showPassword ? "text" : "password"}
                                            autoComplete="current-password"
                                            disabled={busy}
                                            aria-invalid={passwordError ? true : undefined}
                                            aria-describedby={passwordError ? "login-password-error" : undefined}
                                            placeholder="请输入密码"
                                            value={password}
                                            onChange={event => setPassword(event.target.value)}
                                        />
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => setShowPassword(value => !value)}
                                            aria-label={showPassword ? "隐藏密码" : "显示密码"}
                                            aria-pressed={showPassword}
                                            className="absolute top-1/2 right-2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-subtle transition-colors hover:bg-line/40 hover:text-ink disabled:cursor-wait disabled:opacity-50"
                                        >
                                            <Icon name={showPassword ? "eye-off" : "eye"} size={17} />
                                        </button>
                                    </div>
                                    {passwordError && (
                                        <p id="login-password-error" className="mt-1.5 text-13 leading-5 text-danger">
                                            {passwordError}
                                        </p>
                                    )}
                                </div>

                                <div>
                                    <SliderCaptcha passed={captchaPassed} onPassedChange={setCaptchaPassed} />
                                    {captchaError && (
                                        <p id="login-captcha-error" className="mt-1.5 text-13 leading-5 text-danger">
                                            {captchaError}
                                        </p>
                                    )}
                                </div>

                                <div className="flex items-center justify-between">
                                    <label className="flex cursor-pointer items-center gap-2 text-14 text-td select-none">
                                        <input
                                            type="checkbox"
                                            className="peer sr-only"
                                            checked={remember}
                                            onChange={event => setRemember(event.target.checked)}
                                        />
                                        <span
                                            className={`flex size-4 items-center justify-center rounded-sm border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-primary-border ${
                                                remember
                                                    ? "border-primary bg-primary text-white"
                                                    : "border-line-strong bg-surface text-transparent"
                                            }`}
                                        >
                                            <Icon name="check" size={12} />
                                        </span>
                                        记住账号
                                    </label>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setForgetValidated(false);
                                            setView("forget");
                                        }}
                                        className="text-14 font-normal text-primary transition-colors hover:text-primary-hover hover:underline"
                                    >
                                        忘记密码?
                                    </button>
                                </div>

                                <div>
                                    <button
                                        type="submit"
                                        disabled={busy}
                                        aria-busy={busy}
                                        className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-14 font-medium text-white shadow-xs transition-colors hover:bg-primary-hover disabled:cursor-wait disabled:opacity-70"
                                    >
                                        {busy && (
                                            <span
                                                className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white"
                                                aria-hidden="true"
                                            />
                                        )}
                                        {busy ? "正在登录…" : "登录"}
                                    </button>
                                </div>
                            </form>
                        </>
                    ) : (
                        <>
                            <div className="mb-7">
                                <h2 className="text-3xl/9 font-bold tracking-tight text-ink lg:text-4xl">
                                    忘记密码 🤦🏻‍♂️
                                </h2>
                                <p className="mt-1 text-14 text-muted lg:text-15">输入您的账号，查看密码重置方式</p>
                            </div>

                            <form onSubmit={onForgetSubmit} className="flex flex-col gap-5" noValidate>
                                <div>
                                    <div className="group relative">
                                        <Icon
                                            name="user"
                                            size={18}
                                            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-subtle transition-colors group-focus-within:text-primary"
                                        />
                                        <input
                                            id="forget-account"
                                            aria-label="账号"
                                            className={fieldClass(forgetAccountError)}
                                            autoComplete="username"
                                            aria-invalid={forgetAccountError ? true : undefined}
                                            aria-describedby={forgetAccountError ? "forget-account-error" : undefined}
                                            placeholder="请输入账号"
                                            value={forgetAccount}
                                            onChange={event => setForgetAccount(event.target.value)}
                                        />
                                    </div>
                                    {forgetAccountError && (
                                        <p id="forget-account-error" className="mt-1.5 text-13 leading-5 text-danger">
                                            {forgetAccountError}
                                        </p>
                                    )}
                                </div>

                                <button
                                    type="submit"
                                    className="mt-2 flex h-10 w-full items-center justify-center rounded-md bg-primary text-14 font-medium text-white shadow-xs transition-colors hover:bg-primary-hover"
                                >
                                    获取重置方式
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setView("login")}
                                    className="h-10 w-full rounded-md border border-line bg-surface text-14 font-medium text-ink shadow-xs transition-colors hover:bg-soft"
                                >
                                    返回登录
                                </button>
                            </form>
                        </>
                    )}
                </div>
            </main>
        </div>
    );
}
