import type { ReactNode } from "react";

/* KPI 卡：左侧 3px 彩条 + 大数字（工作台 wb-kpi 风格） */
const TONE_BAR: Record<string, string> = {
  default: "bg-[#c7d2fe]",
  cyan: "bg-[#38bdf8]",
  amber: "bg-[#f59e0b]",
  danger: "bg-[#f97066]",
  green: "bg-[#34d399]",
};

const TONE_VALUE: Record<string, string> = {
  cyan: "text-[#0369a1]",
  amber: "text-[#a15c07]",
  danger: "text-danger",
  green: "text-success",
};

interface KpiCardProps {
  label: string;
  value: number;
  unit: string;
  hint?: ReactNode;
  tone?: keyof typeof TONE_BAR;
  onClick?: () => void;
}

export function KpiCard({ label, value, unit, hint, tone = "default", onClick }: KpiCardProps) {
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={`relative flex min-h-[104px] flex-col items-start justify-center gap-0.5 overflow-hidden rounded-card border border-line/70 bg-white/85 px-4 py-4 text-left shadow-xs transition ${onClick ? "hover:border-primary-border hover:shadow-card" : ""}`}
    >
      <span className={`absolute top-0 bottom-0 left-0 w-[3px] ${TONE_BAR[tone]}`} />
      <span className="text-[12.5px] text-muted">{label}</span>
      <span className={`tnum text-[22px] leading-7 font-semibold text-ink ${TONE_VALUE[tone] || ""}`}>
        {value.toLocaleString("zh-CN")}
        <i className="ml-1 text-[12px] font-normal text-subtle not-italic">{unit}</i>
      </span>
      {hint && <span className="text-[11.5px] text-subtle">{hint}</span>}
    </Wrapper>
  );
}

/* 订单页 KPI 摘要卡（三张独立卡：label / 大数字 / 单位 竖排，左侧彩条 靛/青/绿） */
export function OrderSummaryCard({ label, value, unit, barColor }: { label: string; value: number; unit: string; barColor: string }) {
  return (
    <div className="relative flex min-h-[88px] flex-col justify-center overflow-hidden rounded-card border border-line/70 bg-white/95 px-4 py-3 shadow-xs">
      <span className="absolute top-0 bottom-0 left-0 w-[3px]" style={{ background: barColor }} />
      <span className="text-[12px] text-muted">{label}</span>
      <span className="tnum mt-0.5 text-[24px] leading-7 font-extrabold text-ink">{value.toLocaleString("zh-CN")}</span>
      <span className="mt-0.5 text-[12px] text-muted">{unit}</span>
    </div>
  );
}
