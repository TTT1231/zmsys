import test from "node:test";
import assert from "node:assert/strict";
import { ANCHOR, db } from "../mocks/data/db.ts";
import { maxShipOf, readyToShip } from "../src/data/views.ts";

test("inventory allocation and registration preserve quantities", () => {
  const rows = readyToShip(db.snapshot());
  for (const bom of db.boms) {
    const allocated = rows
      .filter((row) => row.bomCode === bom.code)
      .reduce((sum, row) => sum + row.maxShip, 0);
    assert.ok(
      allocated <= db.stockOf(bom.code),
      "one stock pool cannot be promised twice",
    );
  }
  const row = rows.find((item) => item.maxShip > 1);
  assert.ok(row);
  const actor = { name: "测试", roleLabel: "检验员" };
  const input = {
    orderNo: row.orderNo,
    date: ANCHOR,
    operator: "测试",
    remark: "测试",
  };
  const before = db.snapshot();
  for (const qty of [0, -1, 0.5, NaN, maxShipOf(db.snapshot(), row.orderNo) + 1]) {
    assert.throws(() => db.createOutbound({ ...input, qty }, actor));
    assert.deepEqual(db.snapshot(), before, "failed writes must be atomic");
  }
  const allocation = maxShipOf(db.snapshot(), row.orderNo);
  const record = db.createOutbound({ ...input, qty: 1 }, actor);
  assert.equal(record.qty, 1);
  assert.equal(db.stockOf(row.bomCode), row.stock - 1);
  assert.equal(maxShipOf(db.snapshot(), row.orderNo), allocation - 1);
  assert.equal(
    db.remainingOf(db.orders.find((order) => order.orderNo === row.orderNo)),
    row.remaining - 1,
  );
  assert.equal(db.outboundLedger.length, before.outboundLedger.length + 1);
  const afterShipment = db.snapshot();
  assert.throws(() =>
    db.createInbound(
      {
        bomCode: row.bomCode,
        qty: -1,
        date: ANCHOR,
        inspector: "测试",
        remark: "",
      },
      actor,
    ),
  );
  assert.deepEqual(db.snapshot(), afterShipment);
  db.createInbound(
    {
      bomCode: row.bomCode,
      qty: 1,
      date: ANCHOR,
      inspector: "测试",
      remark: "",
    },
    actor,
  );
  assert.equal(db.stockOf(row.bomCode), row.stock);
  for (const bom of db.boms) {
    const inbound = db.inboundLedger
      .filter((item) => item.bomCode === bom.code)
      .reduce((sum, item) => sum + item.qty, 0);
    const outbound = db.outboundLedger
      .filter((item) => item.bomCode === bom.code)
      .reduce((sum, item) => sum + item.qty, 0);
    assert.equal(
      inbound - outbound,
      db.stockOf(bom.code),
      "ledger and inventory remain reconciled",
    );
  }
});
