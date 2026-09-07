import test from "node:test";
import assert from "node:assert/strict";
import { ANCHOR, maxShipOf, readyToShip, store } from "../src/data/store.ts";

test("inventory allocation and registration preserve quantities", () => {
  const rows = readyToShip();
  for (const bom of store.boms) {
    const allocated = rows
      .filter((row) => row.bomCode === bom.code)
      .reduce((sum, row) => sum + row.maxShip, 0);
    assert.ok(
      allocated <= store.stockOf(bom.code),
      "one stock pool cannot be promised twice",
    );
  }
  const row = rows.find((item) => item.maxShip > 1);
  assert.ok(row);
  const input = {
    orderNo: row.orderNo,
    date: ANCHOR,
    operator: "测试",
    remark: "测试",
  };
  const before = store.snapshot();
  for (const qty of [0, -1, 0.5, NaN, row.maxShip + 1]) {
    assert.throws(() => store.createOutbound({ ...input, qty }));
    assert.deepEqual(store.snapshot(), before, "failed writes must be atomic");
  }
  const allocation = maxShipOf(row.orderNo);
  const record = store.createOutbound({ ...input, qty: 1 });
  assert.equal(record.qty, 1);
  assert.equal(store.stockOf(row.bomCode), row.stock - 1);
  assert.equal(maxShipOf(row.orderNo), allocation - 1);
  assert.equal(
    store.remainingOf(
      store.orders.find((order) => order.orderNo === row.orderNo),
    ),
    row.remaining - 1,
  );
  assert.equal(store.outboundLedger.length, before.outboundLedger.length + 1);
  const afterShipment = store.snapshot();
  assert.throws(() =>
    store.createInbound({
      bomCode: row.bomCode,
      qty: -1,
      date: ANCHOR,
      inspector: "测试",
      remark: "",
    }),
  );
  assert.deepEqual(store.snapshot(), afterShipment);
  store.createInbound({
    bomCode: row.bomCode,
    qty: 1,
    date: ANCHOR,
    inspector: "测试",
    remark: "",
  });
  assert.equal(store.stockOf(row.bomCode), row.stock);
  for (const bom of store.boms) {
    const inbound = store.inboundLedger
      .filter((item) => item.bomCode === bom.code)
      .reduce((sum, item) => sum + item.qty, 0);
    const outbound = store.outboundLedger
      .filter((item) => item.bomCode === bom.code)
      .reduce((sum, item) => sum + item.qty, 0);
    assert.equal(
      inbound - outbound,
      store.stockOf(bom.code),
      "ledger and inventory remain reconciled",
    );
  }
});
