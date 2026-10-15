import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { AI_CHAT_LIMITS } from "../src/ai/ai-docs-topics";

/** 聊天只读工具的参数从 OpenAPI 生成，避免手写第二份筛选规则。
 *  pnpm --filter zmsysbackend exec tsx scripts/generate-ai-tools.ts [--check] */
const root = new URL("../../../", import.meta.url);
const api = parse(readFileSync(new URL("docs/openapi.yaml", root), "utf8"));
const endpoints = [
    ["/ai/agent/docs/{topicId}", "操作说明", []],
    ["/workbench/overview", "工作台总览", ["menu:workbench"]],
    ["/workbench/relations", "业务关系", ["menu:analytics", "menu:workbench"]],
    ["/orders", "销售订单", ["orders:view"]],
    ["/customers", "客户档案", ["customers:view"]],
    ["/boms", "物料与 BOM", ["bom:view"]],
    ["/bom-stocks", "成品库存", ["bom:view"]],
    ["/bom-stocks/{code}/ledger", "库存流水", ["bom:view"]],
    ["/inbound", "成品入库", ["inbound:view"]],
    ["/outbound", "成品出库", ["outbound:view"]],
    ["/stock-adjustments", "库存调整", ["inbound:view"]],
    ["/system-logs", "系统日志", ["system-logs:view"]],
    ["/ai/agent/voided/inbound", "作废入库", ["inbound:view"]],
    ["/ai/agent/voided/outbound", "作废出库", ["outbound:view"]],
    ["/ai/agent/deleted", "删除审计", ["system-logs:view"]],
] as const;

function resolve(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(resolve);
    if (!value || typeof value !== "object") return value;
    const object = value as Record<string, unknown>;
    if (typeof object.$ref === "string") {
        const target = object.$ref
            .slice(2)
            .split("/")
            .reduce((current, key) => current[key], api);
        if (!target) throw new Error(`无法解析 ${object.$ref}`);
        return resolve({ ...target, ...Object.fromEntries(Object.entries(object).filter(([key]) => key !== "$ref")) });
    }
    return Object.fromEntries(Object.entries(object).map(([key, child]) => [key, resolve(child)]));
}

const tools = endpoints.map(([path, title, permissions]) => {
    const item = api.paths[path];
    const operation = item?.get;
    if (!operation?.operationId) throw new Error(`缺少 GET ${path}`);
    const parameters = [...(item.parameters ?? []), ...(operation.parameters ?? [])].map(resolve) as Array<{
        name: string;
        in: string;
        required?: boolean;
        description?: string;
        schema: Record<string, unknown>;
    }>;
    return {
        path,
        title,
        permissions,
        pathParams: parameters.filter(parameter => parameter.in === "path").map(parameter => parameter.name),
        tool: {
            type: "function",
            function: {
                name: operation.operationId,
                description: `${operation.summary}。${(operation.description ?? "").replace(/\s+/g, " ")}`.slice(
                    0,
                    1024,
                ),
                parameters: {
                    type: "object",
                    properties: Object.fromEntries(
                        parameters.map(parameter => [
                            parameter.name,
                            {
                                ...parameter.schema,
                                ...(parameter.description ? { description: parameter.description } : {}),
                            },
                        ]),
                    ),
                    required: parameters.filter(parameter => parameter.required).map(parameter => parameter.name),
                    additionalProperties: false,
                },
            },
        },
    };
});
const output = JSON.stringify({ limits: AI_CHAT_LIMITS, tools }, null, 2) + "\n";
const target = new URL("apps/frontend/src/components/ai/tool-catalog.json", root);
if (process.argv.includes("--check")) {
    if (JSON.stringify(JSON.parse(readFileSync(target, "utf8"))) !== JSON.stringify(JSON.parse(output)))
        throw new Error("AI 工具目录已过期，请重新运行生成命令");
} else {
    writeFileSync(target, output);
    process.stdout.write(`已生成 ${tools.length} 个只读工具：${fileURLToPath(target)}\n`);
}
