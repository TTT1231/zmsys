/**
 * 旧基线升级测试（hard-delete 迁移的存量清理分支）：test:db:reset 在空库重放全链，
 * 覆盖不到 20261012100000_hard_delete_drop_soft_delete 对"存量软删行"的物理清理与
 * 残留断言。本测试在专用 scratch 库（*_test 后缀守卫口径）自建旧基线：
 * - 阶段一（正常清理）：重放除新迁移外的全部迁移 → 预置软删订单/入库/出库及子行 +
 *   对照活动行 → 执行新迁移 → 断言软删行及子行物理消失、活动行完好、deleted_at 列
 *   与索引已删、三视图口径正确；
 * - 阶段二（被引用拒绝）：另建基线 → 预置"被库存调整单引用的软删入库" → 执行新迁移
 *   期望断言中止（1146）→ 断言 DML 已回滚、列仍在（DDL 未达，删列后该行会"复活"）。
 * 运行前置同 e2e：本地 MySQL（localhost）+ *_test 库。
 */
import "./db-guard";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import mariadb from "mariadb";
import { afterAll, describe, expect, it } from "vitest";
import { deriveTestDatabase, loadDbEnv } from "../src/configuration/raw-env.js";

const MIGRATIONS_DIR = join(__dirname, "../prisma/migrations");
/** 被测迁移目录名前缀（排除于基线重放，之后单独整文件执行） */
const TARGET_MIGRATION = "20261012100000";

const dbEnv = loadDbEnv();
const TEST_DB = deriveTestDatabase(dbEnv.database);
const SCRATCH_DBS = [`${TEST_DB}_hd1_test`, `${TEST_DB}_hd2_test`] as const;

if (!TEST_DB.endsWith("_test")) {
    throw new Error(`拒绝在非测试库上运行升级测试：${TEST_DB}`);
}
if (!["localhost", "127.0.0.1"].includes(dbEnv.host)) {
    throw new Error(`升级测试仅允许 localhost / 127.0.0.1，当前 host=${dbEnv.host}`);
}

/** multi-statement 连接（基线重放与整文件迁移执行） */
const open = async (database?: string): Promise<mariadb.Connection> =>
    mariadb.createConnection({
        host: dbEnv.host,
        port: dbEnv.port,
        user: dbEnv.user,
        password: dbEnv.password,
        ...(database ? { database } : {}),
        multipleStatements: true,
        sessionVariables: { time_zone: "+00:00" },
    });

/** 新迁移之前的全部迁移 SQL，按目录名序（= prisma 应用序）；跳过 migration_lock.toml
 *  等非迁移目录（以“目录内确有 migration.sql”为准）。库名守卫谓词（20260915100000，
 *  仅放行 zmdb/zmdb_test）外科式替换为 FALSE：scratch 库名以 _test 结尾且仅限
 *  localhost、afterAll 必删，护栏等价；守卫之外的字节原样重放 */
const baselineMigrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter(
        entry =>
            entry.isDirectory() &&
            entry.name !== TARGET_MIGRATION &&
            !entry.name.startsWith(`${TARGET_MIGRATION}_`) &&
            existsSync(join(MIGRATIONS_DIR, entry.name, "migration.sql")),
    )
    .map(entry => entry.name)
    .sort()
    .map(name =>
        readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8").replaceAll(
            "DATABASE() NOT REGEXP '^zmdb(_test)?$'",
            "FALSE",
        ),
    );

const targetMigrationSql = readFileSync(
    join(MIGRATIONS_DIR, `${TARGET_MIGRATION}_hard_delete_drop_soft_delete`, "migration.sql"),
    "utf8",
);

/** 建库并重放旧基线（不含被测迁移） */
const buildBaseline = async (name: string): Promise<mariadb.Connection> => {
    const admin = await open();
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.query(`CREATE DATABASE ${name} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await admin.query(`USE ${name}`);
    for (const sql of baselineMigrations) {
        await admin.query(sql);
    }
    await admin.end();
    return open(name);
};

/** 固定雪花位夹具 id（避开 seed/迁移写入的 id 段） */
const F = {
    user: 990000000000000001n,
    category: 990000000000000101n,
    bom: 990000000000000102n,
    customer: 990000000000000201n,
    deletedOrder: 990000000000000301n,
    activeOrder: 990000000000000302n,
    orderChangeLog: 990000000000000351n,
    deletedInbound: 990000000000000401n,
    activeInbound: 990000000000000402n,
    inboundChangeLog: 990000000000000451n,
    deletedShipment: 990000000000000501n,
    normalLedger: 990000000000000511n,
    correctionLedger: 990000000000000512n,
    stateLog1: 990000000000000521n,
    stateLog2: 990000000000000522n,
    blockedAdjustment: 990000000000000601n,
};

/** 核心 FK 夹具：用户/品类/BOM/客户（两阶段共用；内建角色已由迁移播种，直接引用） */
const CORE_FIXTURES = `
INSERT INTO sys_user (id, account, password_hash, name, role_code, created_at)
VALUES (${F.user}, 'upg9_fixture', 'x', '升级夹具', 'staff', UTC_TIMESTAMP());
INSERT INTO bom_category (id, category_key, name, code_prefix, created_at)
VALUES (${F.category}, 'upg9', '升级夹具品类', 'U9', UTC_TIMESTAMP());
INSERT INTO bom_table (id, bom_code, category_id, spec_hash, request_key, created_by, updated_by, created_at)
VALUES (${F.bom}, 'ZMUPG90001', ${F.category}, UNHEX('0000000000000000000000000000000000000000000000000000000000000000'),
        'upg9-bom', ${F.user}, ${F.user}, UTC_TIMESTAMP());
INSERT INTO custom_table (id, customer_code, name, contact_person, contact_phone, owner_id, request_key,
                          created_by, updated_by, created_at)
VALUES (${F.customer}, 'CUS-UPG9', '升级客户', '张三', '13800000000', ${F.user}, 'upg9-cus',
        ${F.user}, ${F.user}, UTC_TIMESTAMP());
`;

/** 阶段一业务夹具：软删订单（含软删出库全链）+ 软删入库 + 对照活动行 */
const HAPPY_FIXTURES = `
INSERT INTO sales_order_table (id, order_no, customer_id, bom_id, qty, lifecycle_status, order_date,
    deliver_date, remark, customer_name_snapshot, bom_name_snapshot, bom_model_snapshot, bom_spec_snapshot,
    deleted_at, row_version, request_key, created_by, updated_by, created_at)
VALUES (${F.deletedOrder}, 'ZMUPG90001', ${F.customer}, ${F.bom}, 10, 'ACTIVE', CURDATE(), CURDATE(),
    '', '升级客户', '升级BOM', '', '{}', UTC_TIMESTAMP(), 1, 'upg9-key-o1', ${F.user}, ${F.user}, UTC_TIMESTAMP());
INSERT INTO sales_order_change_log (id, order_id, operator_id, event_type, after_version, request_key, before_json, after_json, created_at)
VALUES (${F.orderChangeLog}, ${F.deletedOrder}, ${F.user}, 'CREATE', 1, 'upg9-key-c1', NULL, '{}', UTC_TIMESTAMP());
INSERT INTO sales_order_table (id, order_no, customer_id, bom_id, qty, lifecycle_status, order_date,
    deliver_date, remark, customer_name_snapshot, bom_name_snapshot, bom_model_snapshot, bom_spec_snapshot,
    row_version, request_key, created_by, updated_by, created_at)
VALUES (${F.activeOrder}, 'ZMUPG90002', ${F.customer}, ${F.bom}, 20, 'ACTIVE', CURDATE(), CURDATE(),
    '', '升级客户', '升级BOM', '', '{}', 1, 'upg9-key-o2', ${F.user}, ${F.user}, UTC_TIMESTAMP());

INSERT INTO inbound_ledger (id, entry_no, bom_id, qty, business_date, operator_id, status, row_version,
    request_key, updated_by, created_at, deleted_at)
VALUES (${F.deletedInbound}, 'RKUPG90001', ${F.bom}, 5, CURDATE(), ${F.user}, 'VOIDED', 2,
    'upg9-key-i1', ${F.user}, UTC_TIMESTAMP(), UTC_TIMESTAMP());
INSERT INTO inbound_change_log (id, inbound_id, operator_id, event_type, before_version, after_version,
    reason, request_key, before_json, after_json, created_at)
VALUES (${F.inboundChangeLog}, ${F.deletedInbound}, ${F.user}, 'VOID', 1, 2, '升级夹具作废',
    'upg9-key-v1', '{}', '{}', UTC_TIMESTAMP());
INSERT INTO inbound_ledger (id, entry_no, bom_id, qty, business_date, operator_id, status, row_version,
    request_key, updated_by, created_at)
VALUES (${F.activeInbound}, 'RKUPG90002', ${F.bom}, 7, CURDATE(), ${F.user}, 'ACTIVE', 1,
    'upg9-key-i2', ${F.user}, UTC_TIMESTAMP());

INSERT INTO outbound_shipment (id, shipment_no, order_id, original_qty, business_date, state, voided_by,
    void_reason, voided_at, deleted_at, row_version, request_key, registered_by, registered_at)
VALUES (${F.deletedShipment}, 'CKUPG90001', ${F.deletedOrder}, 10, CURDATE(), 'VOIDED', ${F.user},
    '升级夹具作废', UTC_TIMESTAMP(), UTC_TIMESTAMP(), 2, 'upg9-key-s1', ${F.user}, UTC_TIMESTAMP());
INSERT INTO outbound_ledger (id, event_no, shipment_id, entry_type, qty_delta, business_date, operator_id,
    request_key, created_at)
VALUES (${F.normalLedger}, 'EVUPG90001', ${F.deletedShipment}, 'NORMAL', 10, CURDATE(), ${F.user},
    'upg9-key-e1', UTC_TIMESTAMP());
INSERT INTO outbound_ledger (id, event_no, shipment_id, entry_type, correction_of_id, qty_delta,
    business_date, operator_id, correction_reason, request_key, created_at)
VALUES (${F.correctionLedger}, 'EVUPG90002', ${F.deletedShipment}, 'CORRECTION', ${F.normalLedger}, -10,
    CURDATE(), ${F.user}, '升级夹具冲销', 'upg9-key-e2', UTC_TIMESTAMP());
INSERT INTO outbound_state_log (id, shipment_id, operator_id, event_type, before_state, after_state,
    before_version, after_version, request_key, detail_json, created_at)
VALUES (${F.stateLog1}, ${F.deletedShipment}, ${F.user}, 'REGISTER', NULL, 'REGISTERED', NULL, 1,
    'upg9-key-t1', '{}', UTC_TIMESTAMP()),
       (${F.stateLog2}, ${F.deletedShipment}, ${F.user}, 'VOID', 'REGISTERED', 'VOIDED', 1, 2,
    'upg9-key-t2', '{}', UTC_TIMESTAMP());
`;

/** 阶段二夹具：被库存调整单引用的软删入库（NOT EXISTS 跳过 → 断言必须拒绝） */
const BLOCKED_FIXTURES = `
INSERT INTO inbound_ledger (id, entry_no, bom_id, qty, business_date, operator_id, status, row_version,
    request_key, updated_by, created_at, deleted_at)
VALUES (${F.deletedInbound}, 'RKUPG90001', ${F.bom}, 5, CURDATE(), ${F.user}, 'VOIDED', 2,
    'upg9-key-i1', ${F.user}, UTC_TIMESTAMP(), UTC_TIMESTAMP());
INSERT INTO stock_adjustment (id, adjustment_no, bom_id, qty_delta, business_date, related_inbound_id,
    operator_id, reason, request_key, created_at)
VALUES (${F.blockedAdjustment}, 'TZUPG90001', ${F.bom}, 1, CURDATE(), ${F.deletedInbound},
    ${F.user}, '引用软删入库', 'upg9-key-a1', UTC_TIMESTAMP());
`;

const countOf = async (conn: mariadb.Connection, sql: string): Promise<number> => {
    const rows = (await conn.query(sql)) as Array<{ c: number | bigint }>;
    return Number(rows[0]!.c);
};

describe("硬删除迁移：旧基线升级（存量清理 + 残留断言）", () => {
    const conns: mariadb.Connection[] = [];
    afterAll(async () => {
        const admin = await open();
        for (const name of SCRATCH_DBS) {
            await admin.query(`DROP DATABASE IF EXISTS ${name}`);
        }
        await admin.end();
        await Promise.all(conns.map(conn => conn.end().catch(() => undefined)));
    });

    it("阶段一：存量软删行及子行物理清理，活动行完好，列/索引删除，视图口径正确", async () => {
        const conn = await buildBaseline(SCRATCH_DBS[0]!);
        conns.push(conn);
        await conn.query(CORE_FIXTURES);
        await conn.query(HAPPY_FIXTURES);

        await conn.query(targetMigrationSql); // 期望成功（断言放行）

        // 软删行及子行物理消失；对照活动行完好
        expect(await countOf(conn, `SELECT COUNT(*) c FROM sales_order_table WHERE id = ${F.deletedOrder}`)).toBe(0);
        expect(await countOf(conn, `SELECT COUNT(*) c FROM sales_order_table WHERE id = ${F.activeOrder}`)).toBe(1);
        expect(
            await countOf(conn, `SELECT COUNT(*) c FROM sales_order_change_log WHERE order_id = ${F.deletedOrder}`),
        ).toBe(0);
        expect(await countOf(conn, `SELECT COUNT(*) c FROM inbound_ledger WHERE id = ${F.deletedInbound}`)).toBe(0);
        expect(await countOf(conn, `SELECT COUNT(*) c FROM inbound_ledger WHERE id = ${F.activeInbound}`)).toBe(1);
        expect(
            await countOf(conn, `SELECT COUNT(*) c FROM inbound_change_log WHERE inbound_id = ${F.deletedInbound}`),
        ).toBe(0);
        expect(await countOf(conn, `SELECT COUNT(*) c FROM outbound_shipment WHERE id = ${F.deletedShipment}`)).toBe(0);
        expect(
            await countOf(conn, `SELECT COUNT(*) c FROM outbound_ledger WHERE shipment_id = ${F.deletedShipment}`),
        ).toBe(0);
        expect(
            await countOf(conn, `SELECT COUNT(*) c FROM outbound_state_log WHERE shipment_id = ${F.deletedShipment}`),
        ).toBe(0);

        // 列与索引已删（删列后未清的软删行会在界面"复活"，这是断言守护的对象）
        expect(
            await countOf(
                conn,
                `SELECT COUNT(*) c FROM information_schema.columns WHERE table_schema = DATABASE()
                     AND table_name IN ('sales_order_table','inbound_ledger','outbound_shipment')
                     AND column_name = 'deleted_at'`,
            ),
        ).toBe(0);
        expect(
            await countOf(
                conn,
                `SELECT COUNT(*) c FROM information_schema.statistics WHERE table_schema = DATABASE()
                     AND index_name IN ('idx_sales_order_deleted','idx_inbound_deleted','idx_outbound_deleted')`,
            ),
        ).toBe(0);

        // 视图重建后口径：库存只剩活动入库 7；软删订单/出库不进出库视图
        expect(
            await countOf(conn, `SELECT COALESCE(SUM(stock_qty), 0) c FROM v_bom_stock WHERE bom_id = ${F.bom}`),
        ).toBe(7);
        expect(
            await countOf(conn, `SELECT COUNT(*) c FROM v_outbound_effective_event WHERE order_id = ${F.deletedOrder}`),
        ).toBe(0);
    }, 180_000);

    it("阶段二：被调整单引用的软删入库未清 → 断言中止（DML 回滚、列仍在、DDL 未达）", async () => {
        const conn = await buildBaseline(SCRATCH_DBS[1]!);
        conns.push(conn);
        await conn.query(CORE_FIXTURES);
        await conn.query(BLOCKED_FIXTURES);

        await expect(conn.query(targetMigrationSql)).rejects.toThrow(/assert_soft_delete_residue_nonzero/);
        await conn.query("ROLLBACK"); // 清掉中止时打开的事务，恢复连接可用

        // DML 回滚：被引用软删行仍在；DDL 未达：列仍在（删列即"复活"，断言挡住了）
        expect(await countOf(conn, `SELECT COUNT(*) c FROM inbound_ledger WHERE id = ${F.deletedInbound}`)).toBe(1);
        expect(
            await countOf(
                conn,
                `SELECT COUNT(*) c FROM information_schema.columns WHERE table_schema = DATABASE()
                     AND table_name = 'inbound_ledger' AND column_name = 'deleted_at'`,
            ),
        ).toBe(1);
    }, 180_000);
});
