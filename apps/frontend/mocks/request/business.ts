/* 业务资源 handlers：订单 / 客户 / BOM / 出入库台账 / 系统事件 */
import { http } from "msw";
import type {
    CancelOrderInput,
    CreateCustomerInput,
    CreateInboundInput,
    CreateOrderInput,
    CreateOutboundInput,
    CreateStockAdjustmentInput,
    EmergencyVoidOutboundInput,
    PrintOutboundInput,
    UpdateCustomerInput,
    UpdateInboundInput,
    UpdateOrderInput,
    VoidInboundInput,
    VoidOutboundInput,
} from "@/api";
import { db } from "../data/db";
import { authenticate, authorized, fail, idempotent, ok } from "./shared";

const statusOf = (message: string) =>
    message.includes("不存在") ? 404 : /已被|已存在|已取消|请先|不能打印|只能|库存|同一/.test(message) ? 409 : 400;

export const orderHandlers = [
    http.get("/api/orders", ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        if (!authorized(auth, "orders:view")) return fail("无权查看销售订单", 403);
        return ok(db.orders.map(order => ({ ...order })));
    }),

    http.post("/api/orders", async ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        if (!authorized(auth, "orders:create")) return fail("无权新建销售订单", 403);
        const body = (await request.json().catch(() => null)) as CreateOrderInput | null;
        if (!body) return fail("请求参数错误");
        if (!Number.isSafeInteger(body.qty) || body.qty <= 0) return fail("请输入有效的订单数量");
        try {
            return ok(
                idempotent(request, auth.user.account, "orders:create", body, () => db.createOrder(body, auth.actor)),
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : "订单创建失败";
            return fail(message, statusOf(message));
        }
    }),

    http.put("/api/orders/:orderNo", async ({ request, params }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        if (!authorized(auth, "orders:edit")) return fail("无权修改销售订单", 403);
        const body = (await request.json().catch(() => null)) as UpdateOrderInput | null;
        if (!body || !Number.isSafeInteger(body.expectedVersion)) return fail("请求参数错误");
        try {
            return ok(db.updateOrder({ orderNo: String(params.orderNo), ...body }, auth.actor));
        } catch (error) {
            const message = error instanceof Error ? error.message : "订单修改失败";
            return fail(message, statusOf(message));
        }
    }),

    http.post("/api/orders/:orderNo/cancel", async ({ request, params }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        if (!authorized(auth, "orders:cancel")) return fail("无权取消销售订单", 403);
        const body = (await request.json().catch(() => null)) as CancelOrderInput | null;
        if (!body || !Number.isSafeInteger(body.expectedVersion)) return fail("请求参数错误");
        try {
            const orderNo = String(params.orderNo);
            return ok(
                idempotent(request, auth.user.account, `orders:cancel:${orderNo}`, body, () =>
                    db.cancelOrder(orderNo, body.expectedVersion, body.reason, auth.actor),
                ),
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : "订单取消失败";
            return fail(message, statusOf(message));
        }
    }),
];

export const customerHandlers = [
    http.get("/api/customers", ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        if (!authorized(auth, "customers:view")) return fail("无权查看客户档案", 403);
        return ok(db.listCustomers());
    }),

    http.post("/api/customers", async ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        if (!authorized(auth, "customers:create")) return fail("无权新建客户", 403);
        const body = (await request.json().catch(() => null)) as CreateCustomerInput | null;
        if (!body?.name || body.name.trim().length < 4) return fail("请填写公司名称（至少 4 个字）");
        if (!body?.contact?.trim()) return fail("请输入联系人");
        if (!/^1\d{10}$/.test(body?.phone ?? "")) return fail("请输入 11 位手机号");
        if (!body?.province?.trim() || !body?.city?.trim() || !body?.address?.trim()) {
            return fail("请完善所在地区与地址");
        }
        if (!body?.ownerAccount?.trim()) return fail("请选择客户负责人");
        try {
            return ok(
                idempotent(request, auth.user.account, "customers:create", body, () =>
                    db.createCustomer(body, auth.actor),
                ),
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : "客户创建失败";
            return fail(message, statusOf(message));
        }
    }),

    http.put("/api/customers/:code", async ({ request, params }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        if (!authorized(auth, "customers:edit")) return fail("无权编辑客户", 403);
        const body = (await request.json().catch(() => null)) as UpdateCustomerInput | null;
        if (!body?.name || body.name.trim().length < 4) return fail("请填写公司名称（至少 4 个字）");
        if (!Number.isSafeInteger(body.expectedVersion)) return fail("缺少客户版本");
        if (!body?.contact?.trim()) return fail("请输入联系人");
        if (body?.phone && !/^1\d{10}$/.test(body.phone)) return fail("请输入 11 位手机号");
        if (!body?.province?.trim() || !body?.city?.trim() || !body?.address?.trim())
            return fail("请完善所在地区与地址");
        if (!body?.ownerAccount?.trim()) return fail("请选择客户负责人");
        try {
            return ok(db.updateCustomer(String(params.code), body, auth.actor));
        } catch (error) {
            const message = error instanceof Error ? error.message : "客户更新失败";
            return fail(message, statusOf(message));
        }
    }),
];

export const ledgerHandlers = [
    http.get("/api/inbound", ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        if (!authorized(auth, "inbound:view")) return fail("无权查看入库台账", 403);
        return ok(db.inboundLedger.map(row => ({ ...row })));
    }),

    http.post("/api/inbound", async ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        if (!authorized(auth, "inbound:register")) return fail("无权登记入库", 403);
        const body = (await request.json().catch(() => null)) as CreateInboundInput | null;
        if (!body) return fail("请求参数错误");
        try {
            return ok(
                idempotent(request, auth.user.account, "inbound:create", body, () =>
                    db.createInbound(body, auth.actor),
                ),
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : "入库登记失败";
            return fail(message, statusOf(message));
        }
    }),

    http.put("/api/inbound/:no", async ({ request, params }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        if (!authorized(auth, "inbound:edit")) return fail("无权修正入库", 403);
        const body = (await request.json().catch(() => null)) as UpdateInboundInput | null;
        if (!body || !Number.isSafeInteger(body.expectedVersion)) return fail("请求参数错误");
        try {
            return ok(db.updateInbound(String(params.no), body, auth.actor));
        } catch (error) {
            const message = error instanceof Error ? error.message : "入库修正失败";
            return fail(message, statusOf(message));
        }
    }),

    http.post("/api/inbound/:no/void", async ({ request, params }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        if (!authorized(auth, "inbound:edit")) return fail("无权作废入库", 403);
        const body = (await request.json().catch(() => null)) as VoidInboundInput | null;
        if (!body || !Number.isSafeInteger(body.expectedVersion)) return fail("请求参数错误");
        try {
            const no = String(params.no);
            return ok(
                idempotent(request, auth.user.account, `inbound:void:${no}`, body, () =>
                    db.voidInbound(no, body.expectedVersion, body.reason, auth.actor),
                ),
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : "入库作废失败";
            return fail(message, statusOf(message));
        }
    }),

    http.get("/api/stock-adjustments", ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        if (!authorized(auth, "inbound:view")) return fail("无权查看库存调整", 403);
        return ok(db.stockAdjustments.map(row => ({ ...row })));
    }),

    http.post("/api/stock-adjustments", async ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        if (!authorized(auth, "inbound:adjust")) return fail("只有超级管理员可以执行跨日库存调整", 403);
        const body = (await request.json().catch(() => null)) as CreateStockAdjustmentInput | null;
        if (!body) return fail("请求参数错误");
        try {
            return ok(
                idempotent(request, auth.user.account, "stock-adjustments:create", body, () =>
                    db.createStockAdjustment(body, auth.actor),
                ),
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : "库存调整失败";
            return fail(message, statusOf(message));
        }
    }),

    http.get("/api/outbound", ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        if (!authorized(auth, "outbound:view")) return fail("无权查看出库台账", 403);
        return ok(db.outboundLedger.map(row => ({ ...row })));
    }),

    http.post("/api/outbound", async ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        if (!authorized(auth, "outbound:ship")) return fail("无权登记发货", 403);
        const body = (await request.json().catch(() => null)) as CreateOutboundInput | null;
        if (!body) return fail("请求参数错误");
        try {
            return ok(
                idempotent(request, auth.user.account, "outbound:create", body, () =>
                    db.createOutbound(body, auth.actor),
                ),
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : "发货登记失败";
            return fail(message, statusOf(message));
        }
    }),

    http.post("/api/outbound/:no/void", async ({ request, params }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        if (!authorized(auth, "outbound:void")) return fail("无权作废未打印出库", 403);
        const body = (await request.json().catch(() => null)) as VoidOutboundInput | null;
        if (!body || !Number.isSafeInteger(body.expectedVersion)) return fail("请求参数错误");
        try {
            const no = String(params.no);
            return ok(
                idempotent(request, auth.user.account, `outbound:void:${no}`, body, () =>
                    db.voidOutbound(no, body.expectedVersion, body.reason, auth.actor),
                ),
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : "出库作废失败";
            return fail(message, statusOf(message));
        }
    }),

    http.post("/api/outbound/:no/print", async ({ request, params }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        if (!authorized(auth, "outbound:print")) return fail("无权打印出库单", 403);
        const body = (await request.json().catch(() => null)) as PrintOutboundInput | null;
        if (!body || !Number.isSafeInteger(body.expectedVersion)) return fail("请求参数错误");
        try {
            const no = String(params.no);
            return ok(
                idempotent(request, auth.user.account, `outbound:print:${no}`, body, () =>
                    db.printOutbound(no, body.expectedVersion, body.reason ?? "", auth.actor),
                ),
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : "出库单打印失败";
            return fail(message, statusOf(message));
        }
    }),

    http.post("/api/outbound/:no/emergency-void", async ({ request, params }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        if (!authorized(auth, "outbound:emergency-void")) return fail("只有超级管理员可以紧急撤销", 403);
        const body = (await request.json().catch(() => null)) as EmergencyVoidOutboundInput | null;
        if (!body || !Number.isSafeInteger(body.expectedVersion)) return fail("请求参数错误");
        try {
            const no = String(params.no);
            return ok(
                idempotent(request, auth.user.account, `outbound:emergency-void:${no}`, body, () =>
                    db.emergencyVoidOutbound(
                        no,
                        body.expectedVersion,
                        body.reason,
                        body.goodsNotDeparted,
                        body.paperInvalidated,
                        auth.actor,
                    ),
                ),
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : "紧急撤销失败";
            return fail(message, statusOf(message));
        }
    }),
];
