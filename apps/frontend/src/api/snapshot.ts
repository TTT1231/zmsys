import type { Snapshot } from "./types";
import { fetchOrders } from "./orders";
import { fetchCustomers } from "./customers";
import { fetchBoms } from "./boms";
import { fetchInboundLedger } from "./inbound";
import { fetchOutboundLedger } from "./outbound";
import { fetchUsers } from "./users";
import { fetchSystemEvents } from "./events";

/* 聚合快照：并发拉取各资源，库存由出入库台账推导（Σ入库 − Σ出库） */
export async function fetchSnapshot(): Promise<Snapshot> {
    const [orders, boms, customers, inboundLedger, outboundLedger, users, systemEvents] = await Promise.all([
        fetchOrders(),
        fetchBoms(),
        fetchCustomers(),
        fetchInboundLedger(),
        fetchOutboundLedger(),
        fetchUsers(),
        fetchSystemEvents(),
    ]);
    const stock: Record<string, number> = {};
    inboundLedger.forEach(row => {
        stock[row.bomCode] = (stock[row.bomCode] ?? 0) + row.qty;
    });
    outboundLedger.forEach(row => {
        stock[row.bomCode] = Math.max(0, (stock[row.bomCode] ?? 0) - row.qty);
    });
    return {
        version: Date.now(),
        orders,
        boms,
        customers,
        inboundLedger,
        outboundLedger,
        stock,
        users,
        systemEvents,
    };
}
