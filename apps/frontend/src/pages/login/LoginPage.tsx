import { type FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { Icon } from "@/lib/icons";
import { useApp } from "@/context/AppContext";
import { isApiError } from "@/http";

/* 登录页：账号密码 → POST /auth/login → 建立会话后进入自己角色的工作台 */
export function LoginPage() {
  const { status, login } = useApp();
  const navigate = useNavigate();
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (status === "authenticated") return <Navigate to="/workbench" replace />;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (!account.trim() || !password) {
      setError("请输入账号与密码");
      return;
    }
    setBusy(true);
    try {
      await login(account.trim(), password);
      navigate("/workbench", { replace: true });
    } catch (err) {
      setError(isApiError(err) ? err.message : "登录失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  const fieldClass =
    "h-11 w-full rounded-btn border border-line bg-white px-3 text-[14px] text-ink placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-soft";

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-[400px]">
        <div className="rounded-panel border border-line bg-white p-8 shadow-card">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-gradient-to-br from-[#6366f1] to-[#4f46e5] text-white shadow-[0_6px_18px_rgba(79,70,229,.45)]">
              <Icon name="brand" size={20} />
            </span>
            <div className="leading-tight">
              <div className="text-[17px] font-semibold text-ink">智造管理系统</div>
              <div className="text-[12px] text-muted">订单驱动的成品仓库管理</div>
            </div>
          </div>

          <form onSubmit={onSubmit} className="mt-7 flex flex-col gap-4" noValidate>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink">账号</span>
              <input
                className={fieldClass}
                autoComplete="username"
                placeholder="如 li_xiaomei"
                value={account}
                onChange={(event) => setAccount(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink">密码</span>
              <input
                className={fieldClass}
                type="password"
                autoComplete="current-password"
                placeholder="请输入密码"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>

            {error && (
              <p role="alert" className="rounded-btn bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-1 h-11 rounded-btn bg-primary text-[14px] font-semibold text-white transition hover:bg-primary-hover disabled:opacity-60"
            >
              {busy ? "登录中…" : "登录"}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-[12px] leading-relaxed text-muted">
          演示账号：sys_admin / li_xiaomei / zhou_li / chen_jie / liu_min
          <br />
          初始密码均为 123456
        </p>
      </div>
    </div>
  );
}
