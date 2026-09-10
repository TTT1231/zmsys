/* 业务资源 handlers：订单 / 客户 / BOM / 出入库台账 / 系统事件 */
import { http } from "msw";
import type {
    CreateBomInput,
    CreateCustomerInput,
    CreateInboundInput,
    CreateOrderInput,
    CreateOutboundInput,
    UpdateCustomerInput,
    UpdateOrderInput,
} from "@/api";
import { db } from "../data/db";
import { authenticate, fail, ok } from "./shared";

export const orderHandlers = [
    http.get("/api/orders", ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        return ok(db.orders.map(order => ({ ...order })));
    }),

    http.post("/api/orders", async ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        const body = (await request.json().catch(() => null)) as CreateOrderInput | null;
        if (!body) return fail("请求参数错误");
        if (!Number.isSafeInteger(body.qty) || body.qty <= 0) return fail("请输入有效的订单数量");
        return ok(db.createOrder(body, auth.actor));
    }),

    http.put("/api/orders/:orderNo", async ({ request, params }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        const body = (await request.json().catch(() => null)) as UpdateOrderInput | null;
        if (!body) return fail("请求参数错误");
        try {
            return ok(db.updateOrder({ orderNo: String(params.orderNo), ...body }));
        } catch (error) {
            return fail(error instanceof Error ? error.message : "订单修改失败");
        }
    }),
];

export const customerHandlers = [
    http.get("/api/customers", ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        return ok(db.listCustomers());
    }),

    http.post("/api/customers", async ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        const body = (await request.json().catch(() => null)) as CreateCustomerInput | null;
        if (!body?.name || body.name.trim().length < 4) return fail("请填写公司名称（至少 4 个字）");
        if (!body?.contact?.trim()) return fail("请输入联系人");
        if (!/^1\d{10}$/.test(body?.phone ?? "")) return fail("请输入 11 位手机号");
        if (!body?.province?.trim() || !body?.city?.trim()) return fail("请选择所在地区");
        if (!body?.ownerAccount?.trim()) return fail("请选择客户负责人");
        try {
            return ok(db.createCustomer(body));
        } catch (error) {
            return fail(error instanceof Error ? error.message : "客户创建失败");
        }
    }),

    http.put("/api/customers/:code", async ({ request, params }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        const body = (await request.json().catch(() => null)) as UpdateCustomerInput | null;
        if (!body?.name || body.name.trim().length < 4) return fail("请填写公司名称（至少 4 个字）");
        if (!body?.contact?.trim()) return fail("请输入联系人");
        if (!/^1\d{10}$/.test(body?.phone ?? "")) return fail("请输入 11 位手机号");
        if (!body?.ownerAccount?.trim()) return fail("请选择客户负责人");
        try {
            return ok(db.updateCustomer(String(params.code), body));
        } catch (error) {
            const message = error instanceof Error ? error.message : "客户更新失败";
            return fail(message, message.includes("不存在") ? 404 : 400);
        }
    }),
];

export const bomHandlers = [
    http.get("/api/boms", ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        return ok(db.boms.map(bom => ({ ...bom, specs: { ...bom.specs } })));
    }),

    http.post("/api/boms", async ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        const body = (await request.json().catch(() => null)) as CreateBomInput | null;
        if (!body?.name?.trim()) return fail("请选择品类");
        if (!body?.modelCode?.trim()) return fail("请输入型号");
        try {
            return ok(db.createBom(body));
        } catch (error) {
            return fail(error instanceof Error ? error.message : "BOM 创建失败");
        }
    }),
];

export const ledgerHandlers = [
    http.get("/api/inbound", ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        return ok(db.inboundLedger.map(row => ({ ...row })));
    }),

    http.post("/api/inbound", async ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        const body = (await request.json().catch(() => null)) as CreateInboundInput | null;
        if (!body) return fail("请求参数错误");
        try {
            return ok(db.createInbound(body, auth.actor));
        } catch (error) {
            return fail(error instanceof Error ? error.message : "入库登记失败");
        }
    }),

    http.get("/api/outbound", ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        return ok(db.outboundLedger.map(row => ({ ...row })));
    }),

    http.post("/api/outbound", async ({ request }) => {
        const auth = authenticate(request);
        if (!auth) return fail("登录已过期，请重新登录", 401);
        const body = (await request.json().catch(() => null)) as CreateOutboundInput | null;
        if (!body) return fail("请求参数错误");
        try {
            return ok(db.createOutbound(body, auth.actor));
        } catch (error) {
            return fail(error instanceof Error ? error.message : "发货登记失败");
        }
    }),
];
