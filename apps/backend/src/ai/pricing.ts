/**
 * DeepSeek 模型单价（每百万 tokens、CNY、cache miss 口径、峰谷两档取均值）。
 * 实际计费有峰谷（北京时区工作日 9:00–12:00 / 14:00–18:00 为峰价，其余时段半价）
 * 与 cache hit 折扣，而 ai_usage_log 未记录命中与时段，用量金额只能按均值折算估算，
 * 与实际扣费略有出入。价格来源：api-docs.deepseek.com/quick_start/pricing（2026-10 核对），
 * 新模型上架后在此补表。
 */
import { DEFAULT_AI_MODEL } from "./ai-docs-topics";

interface ModelPrice {
    /** 输入单价（元 / 百万 tokens，峰谷均值） */
    input: number;
    /** 输出单价（元 / 百万 tokens，峰谷均值） */
    output: number;
}

const MODEL_PRICES: Record<string, ModelPrice> = {
    // 输入 1~2 元、输出 4~8 元
    "deepseek-flash": { input: 1.5, output: 6 },
    // 输入 4.5~9 元、输出 13.5~27 元
    "deepseek-v4-pro": { input: 6.75, output: 20.25 },
};

/** 未登记的模型按默认模型单价折算 */
export const estimateCostCny = (model: string, promptTokens: number, completionTokens: number): number => {
    const price = MODEL_PRICES[model] ?? MODEL_PRICES[DEFAULT_AI_MODEL];
    const cost = (promptTokens / 1e6) * price.input + (completionTokens / 1e6) * price.output;
    return Math.round(cost * 1e4) / 1e4;
};
