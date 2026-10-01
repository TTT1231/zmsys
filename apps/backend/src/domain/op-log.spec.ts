import { describe, expect, it, vi } from "vitest";
import { Prisma } from "../generated/prisma/client";
import type { SnowflakeGenerator } from "../common/snowflake";
import type { Tx } from "../prisma/transaction.runner";
import { recordOpLog } from "./op-log";

const operator = { id: "7", name: "测试员工", role: "staff" as const };
const snowflake = { next: () => 9001n } as unknown as SnowflakeGenerator;
const now = new Date("2026-09-12T02:00:00.000Z");

function createTx() {
    const create = vi.fn().mockResolvedValue({});
    return { tx: { opLog: { create } } as unknown as Tx, create };
}

const prismaKnownError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError("prisma error", { code, clientVersion: "test" });

describe("recordOpLog（同事务里程碑审计）", () => {
    // detail 形态受 domain/snapshots.ts 契约约束（按动作收窄，防键名漂移）
    const orderDetail = {
        orderNo: "ZM260912001",
        qty: 10,
        orderDate: "2026-09-12",
        deliverDate: "2026-09-26",
        remark: "",
        lifecycleStatus: "ACTIVE",
        archivedAt: null,
        archiveReason: null,
        bomName: "微动开关",
        bomModel: "1-1",
        bomSpec: { items: [], modelCode: "1-1", spec: "" },
        rowVersion: 1,
        customer: "客户甲",
        customerCode: "CUS-0001",
        bomCode: "ZMKW0001",
        bomRemark: "",
    };

    it("写入姓名/角色快照与业务标识，时间由调用方传入", async () => {
        const { tx, create } = createTx();
        await recordOpLog(tx, snowflake, operator, {
            action: "create_order",
            targetType: "sales_order_table",
            targetId: 500n,
            targetCode: "ZM260912001",
            detail: orderDetail,
            now,
        });
        expect(create).toHaveBeenCalledWith({
            data: {
                id: 9001n,
                operatorId: 7n,
                operatorNameSnapshot: "测试员工",
                operatorRoleSnapshot: "staff",
                action: "create_order",
                targetType: "sales_order_table",
                targetId: 500n,
                targetCode: "ZM260912001",
                detailJson: orderDetail,
                createdAt: now,
            },
        });
    });

    it("同目标同动作可多条写入（update_customer 场景，防重由幂等层承担）", async () => {
        const { tx, create } = createTx();
        const editableOf = (name: string) => ({
            name,
            contactPerson: "张三",
            province: null,
            city: null,
            district: null,
            town: null,
            address: null,
            payTerms: "",
        });
        const params = {
            action: "update_customer" as const,
            targetType: "customer",
            targetId: 600n,
            targetCode: "KH001",
            detail: {
                before: editableOf("旧名称"),
                after: editableOf("新名称"),
                phoneChanged: false,
                ownerChanged: null,
            },
            now,
        };
        await recordOpLog(tx, snowflake, operator, params);
        await recordOpLog(tx, snowflake, operator, {
            ...params,
            detail: { ...params.detail, after: editableOf("再次更名") },
        });
        expect(create).toHaveBeenCalledTimes(2);
    });

    it("其他数据库错误原样抛出", async () => {
        const { tx, create } = createTx();
        create.mockRejectedValue(prismaKnownError("P2003"));
        await expect(
            recordOpLog(tx, snowflake, operator, {
                action: "ship",
                targetType: "outbound_shipment",
                targetId: 600n,
                targetCode: "CK26091201",
                detail: { orderNo: "ZM260912001", qty: 10, remark: "", customer: "客户甲" },
                now,
            }),
        ).rejects.toThrow();
    });
});
