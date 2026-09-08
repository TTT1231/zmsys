/* 权限原型程序化验证：交互 + localStorage/矩阵/日志断言 */
import puppeteer from "puppeteer-core";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1560, height: 1000, deviceScaleFactor: 1 });
page.on("dialog", (d) => d.accept()); // 自动接受 confirm（切换角色丢弃草稿）

const errors = [];
page.on("pageerror", (err) => errors.push(err.message));
page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

await page.goto("file:///C:/Users/Tu1231/Desktop/admin-manage/prototype/permissions.html", { waitUntil: "networkidle0" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle0" });

await page.click('.tab-btn[data-tab="roles"]');
await page.click('.tree-row input[data-menu="outbound"]');
await page.click("#btnSave");
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("zm-permissions-prototype")));
console.log("OUTBOUND_REMOVED:", !saved.warehouse.menus.includes("outbound") ? "PASS" : "FAIL");

await page.click('.tab-btn[data-tab="matrix"]');
const cell = await page.evaluate(() => {
  const row = [...document.querySelectorAll("#matrixTable tr")].find((r) => r.querySelector("th")?.textContent.includes("成品出库"));
  return [...row.querySelectorAll("td")][2].textContent.trim();
});
console.log("MATRIX_WAREHOUSE_OUTBOUND:", cell === "—" ? "PASS" : `FAIL ("${cell}")`);

const logText = await page.evaluate(() => document.querySelector("#logRows").textContent);
console.log("LOG_HAS_REMOVAL:", logText.includes("移除") && logText.includes("成品出库") ? "PASS" : "FAIL");

await page.click('.tab-btn[data-tab="roles"]');
await page.evaluate(() => selectRole("sales"));
await page.click('.tree-row input[data-menu="customers"]'); // 取消
let peek = await page.evaluate(() => ({ m: draft.menus.includes("customers"), a: draft.actions.customers }));
console.log("UNMENU_CLEARS_ACTIONS:", !peek.m && peek.a.length === 0 ? "PASS" : `FAIL (${JSON.stringify(peek)})`);
await page.click('.tree-row input[data-menu="customers"]'); // 重新勾上
peek = await page.evaluate(() => draft.actions.customers);
console.log("MENU_TICK_GIVES_VIEW:", JSON.stringify(peek) === '["view"]' ? "PASS" : `FAIL (${JSON.stringify(peek)})`);
await page.click('.chip-check input[data-menu="customers"][data-action="create"]');
console.log("ACTION_KEEP_MENU:", await page.evaluate(() => document.querySelector('.tree-row input[data-menu="customers"]').checked) ? "PASS" : "FAIL");

await page.evaluate(() => selectRole("super"));
console.log("SUPER_LOCKED:", await page.evaluate(() => document.querySelector("#btnSave").disabled) ? "PASS" : "FAIL");

await page.click('.tab-btn[data-tab="accounts"]');
await page.click(".heading .btn-primary");
await page.type("#fName", "测试用户");
await page.type("#fAccount", "test_user01");
await page.select("#fRole", "staff");
await page.evaluate(() => submitUser());
const userCount = await page.evaluate(() => document.querySelectorAll("#userRows tr").length);
console.log("USER_ADDED:", userCount === 8 ? "PASS" : `FAIL (${userCount})`);

console.log(errors.length ? "JS ERRORS:\n" + errors.join("\n") : "NO JS ERRORS");
await browser.close();
