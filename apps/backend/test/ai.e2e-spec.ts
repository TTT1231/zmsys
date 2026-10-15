/**
 * AI 助手模块集成测试：真实 HTTP 管线 + 真实测试库 + 本地 mock OpenAI 兼容上游。
 * 覆盖：agent 文档清单/单篇/404；作废入库/出库薄查询（走真实登记→作废链路）；
 * 已删除审计（走真实客户删除链路，断言 detail 快照）；工作台配置读写/脱敏/
 * op_log 审计（不含 key 内容）；对话代理非流式/流式/上游 5xx/中途断流；
 * 用量按人聚合；各端点正反权限用例（staff 越权 403 / 登录即可 200）。
 * 断言用 RUN 标识收敛到本套件数据（测试库为共享库）。运行前置：pnpm test:db:reset。
 */
import "./db-guard";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/main";
import { PrismaService } from "../src/prisma/prisma.service";
import { SnowflakeGenerator } from "../src/common/snowflake";
import { materialSetHash } from "../src/common/bom-spec";

const RUN = Date.now().toString(36);
const accountOf = (name: string): string => `qa_ai_${name}_${RUN}`;
const authHeaders = (token: string) => ({ authorization: `Bearer ${token}` });
const today = (): string => new Date().toISOString().slice(0, 10);
const plusDays = (days: number): string => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

/** mock 上游最近一次收到的请求体（断言 model/max_tokens/stream_options 用） */
let lastUpstreamBody: Record<string, unknown> | null = null;

describe("AI 助手 (e2e)", () => {
    let app: NestFastifyApplication;
    let prisma: PrismaService;
    let snowflake: SnowflakeGenerator;
    let superToken: string;
    let staffToken: string;
    let mockBaseUrl: string;
    let mockServer: http.Server;
    // 本套件造的业务数据（断言收敛用）
    let bomCode: string;
    let customerCode: string;
    let customerName: string;
    let entryNo: string;
    let shipmentNo: string;
    let orderNo: string;
    const voidReason = `ai-e2e-作废-${RUN}`;

    const login = async (account: string): Promise<string> => {
        const res = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { account, password: "123456" },
        });
        expect(res.statusCode).toBe(200);
        return (res.json() as { data: { accessToken: string } }).data.accessToken;
    };

    const post = async (
        url: string,
        token: string,
        payload: Record<string, unknown>,
        idemKey: string,
    ): Promise<{ statusCode: number; body: { code?: number; data?: unknown; message?: string } }> => {
        const res = await app.inject({
            method: "POST",
            url: `/api${url}`,
            headers: { ...authHeaders(token), "idempotency-key": idemKey },
            payload,
        });
        return { statusCode: res.statusCode, body: res.json() };
    };

    const put = async (
        url: string,
        token: string,
        payload: Record<string, unknown>,
    ): Promise<{ statusCode: number; body: { code?: number; data?: unknown; message?: string } }> => {
        const res = await app.inject({
            method: "PUT",
            url: `/api${url}`,
            headers: authHeaders(token),
            payload,
        });
        return { statusCode: res.statusCode, body: res.json() };
    };

    const get = async (
        url: string,
        token: string,
    ): Promise<{ statusCode: number; body: { code?: number; data?: unknown; message?: string } }> => {
        const res = await app.inject({ method: "GET", url: `/api${url}`, headers: authHeaders(token) });
        return { statusCode: res.statusCode, body: res.json() };
    };

    beforeAll(async () => {
        // ---- mock OpenAI 兼容上游（ephemeral 端口；model=mock-fail-500 回 5xx，
        //      首条消息 content=midfail 时流式中途断开）----
        mockServer = http.createServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on("data", (chunk: Buffer) => chunks.push(chunk));
            req.on("end", () => {
                const url = req.url ?? "";
                if (req.method === "POST" && url.startsWith("/chat/completions")) {
                    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
                    lastUpstreamBody = body;
                    if (body.model === "mock-fail-500") {
                        res.writeHead(500, { "content-type": "application/json" });
                        res.end(JSON.stringify({ error: { message: "mock 上游错误" } }));
                        return;
                    }
                    const firstContent = (body.messages as Array<{ content: string }>)[0]?.content;
                    if (body.stream === true && firstContent === "prefail") {
                        // 响应头前连接即断：后端应回 502 信封（不是 SSE error）
                        res.destroy();
                        return;
                    }
                    if (body.stream === true && firstContent === "midfail") {
                        // 头已发出、流中途断开：后端应以 SSE event: error 收尾。
                        // 帧经写回执确认 flush 后再延时销毁——纯定时器在负载下会在头
                        // flush 前销毁，退化成"头前失败"场景
                        res.writeHead(200, { "content-type": "text/event-stream" });
                        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "半" } }] })}\n\n`, () => {
                            setTimeout(() => {
                                if (!res.writableEnded) {
                                    res.destroy();
                                }
                            }, 30);
                        });
                        return;
                    }
                    if (body.stream === true) {
                        res.writeHead(200, { "content-type": "text/event-stream" });
                        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "你好" } }] })}\n\n`);
                        res.write(
                            `data: ${JSON.stringify({
                                choices: [],
                                usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
                            })}\n\n`,
                        );
                        res.write("data: [DONE]\n\n");
                        res.end();
                        return;
                    }
                    res.writeHead(200, { "content-type": "application/json" });
                    // content=nouse：模拟忽略 usage 的网关（成功但用量未知）
                    if (firstContent === "nouse") {
                        res.end(JSON.stringify({ choices: [{ message: { content: "pong" }, finish_reason: "stop" }] }));
                        return;
                    }
                    res.end(
                        JSON.stringify({
                            choices: [{ message: { content: "pong" }, finish_reason: "stop" }],
                            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
                        }),
                    );
                    return;
                }
                res.writeHead(404);
                res.end();
            });
        });
        await new Promise<void>(resolve => mockServer.listen(0, "127.0.0.1", resolve));
        mockBaseUrl = `http://127.0.0.1:${(mockServer.address() as AddressInfo).port}`;

        const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
        configureApp(app);
        await app.init();
        prisma = app.get(PrismaService);
        snowflake = app.get(SnowflakeGenerator);
        superToken = await login("guojun");
        staffToken = await login("test");

        // ---- 专用 BOM（直写 prisma：查询端点测试不依赖建档 API 的目录约束）----
        const category = await prisma.bomCategory.findFirstOrThrow();
        const bomId = snowflake.next();
        bomCode = `AIE2E${bomId.toString(36)}`.slice(0, 32);
        await prisma.bomTable.create({
            data: {
                id: bomId,
                bomCode,
                categoryId: category.id,
                specHash: materialSetHash(category.id, [], `ai-e2e-${RUN}`),
                remark: `ai-e2e-${RUN}`,
                requestKey: `ai-e2e-bom-${RUN}`,
                createdBy: 1n,
                updatedBy: 1n,
                createdAt: new Date(),
            },
        });

        // ---- 销售线用户（客户负责人须为销售）----
        const salesAccount = accountOf("sales");
        const salesUserRes = await post(
            "/users",
            superToken,
            {
                name: `AI联调销售${RUN}`,
                account: salesAccount,
                role: "sales",
            },
            `ai-e2e-sales-${RUN}`,
        );
        expect(salesUserRes.statusCode).toBe(200);

        // ---- 客户 → 入库（作废一张 + 保留一张供出库）----
        const customerRes = await post(
            "/customers",
            superToken,
            {
                name: `AI联调客户${RUN}`,
                contact: "联系人",
                phone: "13800001111",
                ownerAccount: salesAccount,
                payTerms: "月结",
            },
            `ai-e2e-cust-${RUN}`,
        );
        expect(customerRes.statusCode).toBe(200);
        const customer = customerRes.body.data as { code: string; name: string };
        customerCode = customer.code;
        customerName = customer.name;

        const inboundRes = await post(
            "/inbound",
            superToken,
            {
                bomCode,
                qty: 10,
                date: today(),
                remark: `ai-e2e-${RUN}`,
            },
            `ai-e2e-in-${RUN}`,
        );
        expect(inboundRes.statusCode).toBe(200);
        const inboundRow = inboundRes.body.data as { no: string; version: number };
        entryNo = inboundRow.no;
        const voidInboundRes = await post(
            `/inbound/${entryNo}/void`,
            superToken,
            {
                expectedVersion: inboundRow.version,
                reason: voidReason,
            },
            `ai-e2e-invoid-${RUN}`,
        );
        expect(voidInboundRes.statusCode).toBe(200);

        // 有效库存（作废不计库存，出库前需另有入库）
        const stockRes = await post(
            "/inbound",
            superToken,
            {
                bomCode,
                qty: 10,
                date: today(),
                remark: `ai-e2e-stock-${RUN}`,
            },
            `ai-e2e-instock-${RUN}`,
        );
        expect(stockRes.statusCode).toBe(200);

        // ---- 订单 → 出库 → 作废出库 ----
        const orderRes = await post(
            "/orders",
            superToken,
            {
                customerCode,
                bomCode,
                qty: 5,
                orderDate: today(),
                deliverDate: plusDays(7),
                remark: `ai-e2e-${RUN}`,
            },
            `ai-e2e-ord-${RUN}`,
        );
        expect(orderRes.statusCode, JSON.stringify(orderRes.body)).toBe(200);
        orderNo = (orderRes.body.data as { orderNo: string }).orderNo;
        const outboundRes = await post(
            "/outbound",
            superToken,
            {
                orderNo,
                qty: 3,
                date: today(),
                remark: `ai-e2e-${RUN}`,
            },
            `ai-e2e-out-${RUN}`,
        );
        expect(outboundRes.statusCode).toBe(200);
        const shipmentRow = outboundRes.body.data as { no: string; version: number };
        shipmentNo = shipmentRow.no;
        const voidOutboundRes = await post(
            `/outbound/${shipmentNo}/void`,
            superToken,
            {
                expectedVersion: shipmentRow.version,
                reason: voidReason,
            },
            `ai-e2e-outvoid-${RUN}`,
        );
        expect(voidOutboundRes.statusCode).toBe(200);

        // ---- 删除客户（无订单引用的另一客户，产生 delete_customer 快照）----
        const customer2Res = await post(
            "/customers",
            superToken,
            {
                name: `AI联调待删客户${RUN}`,
                contact: "联系人",
                phone: "13900002222",
                ownerAccount: salesAccount,
                payTerms: "现结",
            },
            `ai-e2e-cust2-${RUN}`,
        );
        expect(customer2Res.statusCode).toBe(200);
        const customer2 = customer2Res.body.data as { code: string; version: number };
        const deleteRes = await post(
            `/customers/${customer2.code}/delete`,
            superToken,
            {
                expectedVersion: customer2.version,
            },
            `ai-e2e-custdel-${RUN}`,
        );
        expect(deleteRes.statusCode).toBe(200);
        customerCode = customer2.code; // deleted 查询断言用待删客户的编码
    });

    afterAll(async () => {
        await new Promise<void>(resolve => mockServer.close(() => resolve()));
        await app.close();
    });

    // ---------- agent 文档 ----------

    it("文档清单：root 非空 + 六个主题", async () => {
        const res = await get("/ai/agent/docs", superToken);
        expect(res.statusCode).toBe(200);
        const data = res.body.data as { root: string; topics: Array<{ id: string }> };
        expect(data.root.length).toBeGreaterThan(200);
        expect(data.topics.map(topic => topic.id).sort()).toEqual([
            "analytics",
            "endpoints",
            "operations",
            "process",
            "roles",
            "user-guide",
        ]);
    });

    it("单篇文档：staff 登录即可读；未知主题 404", async () => {
        const res = await get("/ai/agent/docs/operations", staffToken);
        expect(res.statusCode).toBe(200);
        expect((res.body.data as { markdown: string }).markdown.length).toBeGreaterThan(0);
        const guide = await get("/ai/agent/docs/user-guide", staffToken);
        expect(guide.statusCode).toBe(200);
        expect((guide.body.data as { markdown: string }).markdown).toContain("```mermaid");
        const missing = await get("/ai/agent/docs/nope", superToken);
        expect(missing.statusCode).toBe(404);
    });

    it("入库和出库列表带实际成品计量单位，供 AI 准确汇总", async () => {
        const inbound = await get("/inbound", superToken);
        const outbound = await get("/outbound", superToken);
        expect(inbound.statusCode).toBe(200);
        expect(outbound.statusCode).toBe(200);
        const inboundRow = (inbound.body.data as Array<{ no: string; unit: string }>).find(row => row.no === entryNo);
        const outboundRow = (outbound.body.data as Array<{ no: string; unit: string }>).find(
            row => row.no === shipmentNo,
        );
        expect(inboundRow?.unit).toBe("个");
        expect(outboundRow?.unit).toBe("个");
    });

    // ---------- 作废查询 ----------

    it("作废入库：bomCode 收敛到本套件数据，含作废人/原因", async () => {
        const res = await get(`/ai/agent/voided/inbound?bomCode=${bomCode}`, superToken);
        expect(res.statusCode).toBe(200);
        const data = res.body.data as {
            items: Array<{ entryNo: string; voidReason: string | null; voidedBy: string; status: string }>;
            total: number;
        };
        expect(data.total).toBeGreaterThanOrEqual(1);
        const item = data.items.find(row => row.entryNo === entryNo);
        expect(item).toBeDefined();
        expect(item!.status).toBe("voided");
        expect(item!.voidReason).toBe(voidReason);
        expect(item!.voidedBy.length).toBeGreaterThan(0);
    });

    it("作废出库：orderNo 精确收敛，含客户快照与原因", async () => {
        const res = await get(`/ai/agent/voided/outbound?orderNo=${orderNo}`, superToken);
        expect(res.statusCode).toBe(200);
        const data = res.body.data as {
            items: Array<{ shipmentNo: string; customerName: string; voidReason: string | null }>;
            total: number;
        };
        const item = data.items.find(row => row.shipmentNo === shipmentNo);
        expect(item).toBeDefined();
        expect(item!.customerName).toBe(customerName);
        expect(item!.voidReason).toBe(voidReason);
    });

    // ---------- 已删除审计 ----------

    it("作废出库：订单号和 BOM 同时筛选时都必须匹配", async () => {
        const matching = await get(`/ai/agent/voided/outbound?orderNo=${orderNo}&bomCode=${bomCode}`, superToken);
        expect(matching.statusCode).toBe(200);
        expect(
            (matching.body.data as { items: Array<{ shipmentNo: string }> }).items.some(
                row => row.shipmentNo === shipmentNo,
            ),
        ).toBe(true);
        const mismatch = await get(`/ai/agent/voided/outbound?orderNo=ORDER_OTHER&bomCode=${bomCode}`, superToken);
        expect(mismatch.statusCode).toBe(200);
        expect(mismatch.body.data).toEqual({ items: [], total: 0 });
    });

    it("已删除：delete_customer 快照可查，detail 为结构化快照", async () => {
        const res = await get(`/ai/agent/deleted?domain=customer&keyword=${customerCode}`, superToken);
        expect(res.statusCode).toBe(200);
        const data = res.body.data as {
            items: Array<{
                action: string;
                targetCode: string;
                operator: { name: string };
                detail: { name?: string };
            }>;
        };
        const item = data.items.find(row => row.targetCode === customerCode);
        expect(item).toBeDefined();
        expect(item!.action).toBe("delete_customer");
        expect(item!.detail.name).toContain("AI联调待删客户");
        expect(item!.operator.name.length).toBeGreaterThan(0);
    });

    it("已删除查询：staff 无 system-logs:view 得 403", async () => {
        const res = await get("/ai/agent/deleted", staffToken);
        expect(res.statusCode).toBe(403);
    });

    it("已删除/作废查询：非 ASCII keyword（中文姓名/名称）被 400 拒绝而非 500", async () => {
        const deleted = await get("/ai/agent/deleted?keyword=%E9%83%AD%E5%9D%87", superToken); // 郭均
        expect(deleted.statusCode).toBe(400);
        const voidedInbound = await get(
            `/ai/agent/voided/inbound?keyword=${encodeURIComponent("数量错了")}`,
            superToken,
        );
        expect(voidedInbound.statusCode).toBe(400);
        const voidedOutbound = await get(
            `/ai/agent/voided/outbound?keyword=${encodeURIComponent("发错了")}`,
            superToken,
        );
        expect(voidedOutbound.statusCode).toBe(400);
    });

    // ---------- 对话代理：未配置 503 ----------

    it("未配置时对话返回 503（文案引导联系超管）", async () => {
        const res = await post(
            "/ai/chat",
            staffToken,
            {
                messages: [{ role: "user", content: "ping" }],
            },
            `ai-e2e-chat0-${RUN}`,
        );
        expect(res.statusCode).toBe(503);
        expect(res.body.message).toContain("AI 工作台");
    });

    // ---------- 工作台配置 ----------

    it("初始配置读取：默认值 + 未存 key", async () => {
        const res = await get("/ai/admin/settings", superToken);
        expect(res.statusCode).toBe(200);
        const data = res.body.data as { apiKeySet: boolean; model: string; enabled: boolean };
        expect(data.apiKeySet).toBe(false);
        expect(data.model).toBe("deepseek-flash");
        expect(data.enabled).toBe(false);
    });

    it("首次配置缺 apiKey 得 400；完整配置后脱敏返回且不含明文", async () => {
        const missing = await put("/ai/admin/settings", superToken, { baseUrl: mockBaseUrl });
        expect(missing.statusCode).toBe(400);
        expect(missing.body.message).toContain("API Key");

        const res = await put("/ai/admin/settings", superToken, {
            baseUrl: mockBaseUrl,
            apiKey: "sk-mock-key-123",
            model: "mock-model",
            enabled: true,
        });
        expect(res.statusCode).toBe(200);
        const data = res.body.data as { apiKeySet: boolean; apiKeyMasked: string };
        expect(data.apiKeySet).toBe(true);
        expect(data.apiKeyMasked).toBe("sk-••••-123");
        expect(JSON.stringify(res.body)).not.toContain("sk-mock-key-123");
    });

    it("部分更新：apiKey 省略=保留原值", async () => {
        const res = await put("/ai/admin/settings", superToken, { model: "mock-model-2" });
        expect(res.statusCode).toBe(200);
        const data = res.body.data as { apiKeySet: boolean; model: string };
        expect(data.apiKeySet).toBe(true);
        expect(data.model).toBe("mock-model-2");
    });

    it("配置变更写 op_log 审计，快照不含 key 内容", async () => {
        const rows = await prisma.opLog.findMany({ where: { action: "update_ai_config" } });
        expect(rows.length).toBeGreaterThanOrEqual(2);
        expect(JSON.stringify(rows.map(row => row.detailJson))).not.toContain("sk-mock-key-123");
    });

    it("配置/用量端点：staff 得 403", async () => {
        expect((await get("/ai/admin/settings", staffToken)).statusCode).toBe(403);
        expect((await put("/ai/admin/settings", staffToken, { enabled: false })).statusCode).toBe(403);
        expect((await get("/ai/admin/usage", staffToken)).statusCode).toBe(403);
        expect((await post("/ai/admin/test", staffToken, {}, `ai-e2e-t403-${RUN}`)).statusCode).toBe(403);
    });

    it("连通测试：走 mock 上游，断言 max_tokens=1", async () => {
        lastUpstreamBody = null;
        const res = await post("/ai/admin/test", superToken, {}, `ai-e2e-test-${RUN}`);
        expect(res.statusCode).toBe(200);
        const data = res.body.data as { ok: boolean; latencyMs: number; model: string };
        expect(data.ok).toBe(true);
        expect(data.model).toBe("mock-model-2");
        expect(lastUpstreamBody).toMatchObject({ model: "mock-model-2", max_tokens: 1 });
    });

    it("状态端点：登录即可读配置态", async () => {
        const res = await get("/ai/status", staffToken);
        expect(res.statusCode).toBe(200);
        expect(res.body.data).toMatchObject({ enabled: true, configured: true, model: "mock-model-2" });
    });

    // ---------- 对话代理 ----------

    it("对话代理透传工具定义、工具调用和工具结果", async () => {
        const messages = [
            { role: "user", content: "ping" },
            {
                role: "assistant",
                content: "",
                reasoning_content: "先查询订单，再根据查询结果回答。",
                tool_calls: [{ id: "call_1", type: "function", function: { name: "listOrders", arguments: "{}" } }],
            },
            { role: "tool", tool_call_id: "call_1", content: "[]" },
        ];
        const tools = [
            { type: "function", function: { name: "listOrders", parameters: { type: "object", properties: {} } } },
        ];
        const result = await post(
            "/ai/chat",
            superToken,
            { messages, tools, tool_choice: "auto" },
            `ai-e2e-tools-${RUN}`,
        );
        expect(result.statusCode).toBe(200);
        expect(lastUpstreamBody).toMatchObject({ messages, tools, tool_choice: "auto" });
    });

    it("HTTP 消息上限统一为 40 条，字节体积仍独立限制为 1MiB", async () => {
        const messages = Array.from({ length: 40 }, () => ({ role: "user", content: "ping" }));
        expect((await post("/ai/chat", superToken, { messages }, `ai-e2e-limit40-${RUN}`)).statusCode).toBe(200);
        expect(
            (await post("/ai/chat", superToken, { messages: [...messages, messages[0]] }, `ai-e2e-limit41-${RUN}`))
                .statusCode,
        ).toBe(400);
        const oversized = Array.from({ length: 40 }, () => ({ role: "user", content: "中".repeat(16_000) }));
        expect(
            (await post("/ai/chat", superToken, { messages: oversized }, `ai-e2e-limit-bytes-${RUN}`)).statusCode,
        ).toBe(413);
    });

    it("非流式对话（staff）：转发参数正确、usage 记账归属 staff", async () => {
        lastUpstreamBody = null;
        const res = await post(
            "/ai/chat",
            staffToken,
            {
                messages: [{ role: "user", content: "ping" }],
            },
            `ai-e2e-chat1-${RUN}`,
        );
        expect(res.statusCode).toBe(200);
        const data = res.body.data as {
            content: string;
            model: string;
            usage: { promptTokens: number; totalTokens: number };
        };
        expect(data.content).toBe("pong");
        expect(data.model).toBe("mock-model-2");
        expect(data.usage).toMatchObject({ promptTokens: 10, totalTokens: 15 });
        // 上游收到固定 max_tokens 与完整 messages（含鉴权头由 baseUrl 配置保证）
        expect(lastUpstreamBody).toMatchObject({
            model: "mock-model-2",
            max_tokens: 4096,
            messages: [{ role: "user", content: "ping" }],
        });
    });

    it("流式对话：SSE 直通含 [DONE]，usage 经嗅探记账", async () => {
        const res = await app.inject({
            method: "POST",
            url: "/api/ai/chat/stream",
            headers: { ...authHeaders(superToken), "idempotency-key": `ai-e2e-chat2-${RUN}` },
            payload: { messages: [{ role: "user", content: "hi" }] },
        });
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-type"]).toContain("text/event-stream");
        const body = res.payload;
        expect(body).toContain("data: [DONE]");
        expect(lastUpstreamBody).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    });

    it("成功但上游未回 usage：success 记账 + 用量未知标注（不当确定零）", async () => {
        const res = await post(
            "/ai/chat",
            superToken,
            {
                messages: [{ role: "user", content: "nouse" }],
            },
            `ai-e2e-chat-nouse-${RUN}`,
        );
        expect(res.statusCode).toBe(200);
        expect((res.body.data as { usage: { totalTokens: number } }).usage.totalTokens).toBe(0);
        expect((res.body.data as { usage: { status: string } }).usage.status).toBe("unknown");
        const unknownRow = await prisma.aiUsageLog.findFirst({
            where: { status: "success", errorMessage: { contains: "用量未知" } },
        });
        expect(unknownRow).not.toBeNull();
        expect(unknownRow!.totalTokens).toBe(0);
    });

    it("上游 5xx：非流式 502 信封 + error 记账", async () => {
        await put("/ai/admin/settings", superToken, { model: "mock-fail-500" });
        const res = await post(
            "/ai/chat",
            superToken,
            {
                messages: [{ role: "user", content: "ping" }],
            },
            `ai-e2e-chat3-${RUN}`,
        );
        expect(res.statusCode).toBe(502);
        expect(res.body.message).toContain("HTTP 500");
        await put("/ai/admin/settings", superToken, { model: "mock-model-2" });
    });

    it("流式上游连接失败（响应头前）：502 信封 + error 记账", async () => {
        const res = await app.inject({
            method: "POST",
            url: "/api/ai/chat/stream",
            headers: { ...authHeaders(superToken), "idempotency-key": `ai-e2e-chat4a-${RUN}` },
            payload: { messages: [{ role: "user", content: "prefail" }] },
        });
        expect(res.statusCode).toBe(502);
        expect((res.json() as { message: string }).message).toBeTruthy();
    });

    it("流式中途断流：SSE error 事件收尾 + error 记账（用量未知）", async () => {
        const res = await app.inject({
            method: "POST",
            url: "/api/ai/chat/stream",
            headers: { ...authHeaders(superToken), "idempotency-key": `ai-e2e-chat4-${RUN}` },
            payload: { messages: [{ role: "user", content: "midfail" }] },
        });
        expect(res.statusCode).toBe(200);
        expect(res.payload).toContain("event: error");
        const errorRows = await prisma.aiUsageLog.findMany({
            where: { status: "error" },
            select: { errorMessage: true, model: true },
        });
        expect(
            errorRows.length,
            JSON.stringify(errorRows.map(row => ({ model: row.model, message: row.errorMessage }))),
        ).toBeGreaterThanOrEqual(3);
    });

    it("停用后对话 503；重新启用", async () => {
        await put("/ai/admin/settings", superToken, { enabled: false });
        const res = await post(
            "/ai/chat",
            superToken,
            {
                messages: [{ role: "user", content: "ping" }],
            },
            `ai-e2e-chat5-${RUN}`,
        );
        expect(res.statusCode).toBe(503);
        await put("/ai/admin/settings", superToken, { enabled: true });
    });

    // ---------- 用量聚合 ----------

    it("按人聚合：staff 的成功对话 token 已入账，按日含今天", async () => {
        const res = await get("/ai/admin/usage?range=today", superToken);
        expect(res.statusCode).toBe(200);
        const data = res.body.data as {
            totals: { requests: number; successRequests: number; errorRequests: number };
            users: Array<{ account: string; totalTokens: number }>;
            byDay: Array<{ date: string }>;
        };
        expect(data.totals.successRequests).toBeGreaterThanOrEqual(2);
        expect(data.totals.errorRequests).toBeGreaterThanOrEqual(2);
        const staffRow = data.users.find(row => row.account === "test");
        expect(staffRow).toBeDefined();
        expect(staffRow!.totalTokens).toBe(15);
        expect(
            data.byDay.some(
                day =>
                    day.date === today() || day.date === new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10),
            ),
        ).toBe(true);
    });
});
