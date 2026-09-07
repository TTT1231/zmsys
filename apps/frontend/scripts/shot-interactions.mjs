/* 交互验证：弹窗 + 移动端视口 */
import puppeteer from "puppeteer-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT = "C:\\Users\\Tu1231\\Desktop\\admin-manage\\scripts\\shots\\";

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-first-run", "--hide-scrollbars"],
});
const page = await browser.newPage();

// 1) 新建订单弹窗（桌面）
await page.setViewport({ width: 1600, height: 900 });
await page.goto("http://localhost:5180/orders", { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1500));
await page.click("#new-order-button").catch(() => {});
await page.evaluate(() => {
  const buttons = [...document.querySelectorAll("button")];
  buttons.find((b) => b.textContent?.includes("新建订单"))?.click();
});
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: `${OUT}app-modal-new-order.png` });
console.log("saved new-order modal");

// 2) 出库弹窗
await page.goto("http://localhost:5180/outbound", { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(() => {
  const buttons = [...document.querySelectorAll("button")];
  buttons.find((b) => b.textContent?.includes("登记发货"))?.click();
});
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: `${OUT}app-modal-outbound.png` });
console.log("saved outbound modal");

// 3) 关闭弹窗（Esc），移动端视口工作台
await page.goto("http://localhost:5180/workbench/admin", { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1500));
await page.setViewport({ width: 390, height: 844 });
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: `${OUT}app-mobile-workbench.png` });
console.log("saved mobile workbench");

// 4) 移动端抽屉
await page.evaluate(() => {
  const buttons = [...document.querySelectorAll("button")];
  buttons.find((b) => b.getAttribute("aria-label") === "打开主导航")?.click();
});
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: `${OUT}app-mobile-drawer.png` });
console.log("saved mobile drawer");

// 5) 移动端订单页
await page.goto("http://localhost:5180/orders", { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: `${OUT}app-mobile-orders.png` });
console.log("saved mobile orders");

await browser.close();
