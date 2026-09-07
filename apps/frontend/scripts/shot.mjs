/* UI 验证截图脚本：用本机 Edge 无头模式截取页面 */
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT_DIR = new URL("./shots/", import.meta.url).pathname.replace(/^\//, "").replace(/\//g, "\\");

const targets = process.argv.slice(2);
const PAGES = {
  "app-workbench-admin": "http://localhost:5180/workbench/admin",
  "app-workbench-sales": "http://localhost:5180/workbench/sales",
  "app-workbench-warehouse": "http://localhost:5180/workbench/warehouse",
  "app-orders": "http://localhost:5180/orders",
  "app-customers": "http://localhost:5180/customers",
  "app-bom": "http://localhost:5180/bom",
  "app-production": "http://localhost:5180/production",
  "app-inbound": "http://localhost:5180/inbound",
  "app-outbound": "http://localhost:5180/outbound",
  "app-permissions": "http://localhost:5180/permissions",
  "proto-orders": "http://localhost:5181/manufacturing-dashboard-responsive.html#orders",
  "proto-customers": "http://localhost:5181/manufacturing-dashboard-responsive.html#customers",
  "proto-bom": "http://localhost:5181/manufacturing-dashboard-responsive.html#bom",
  "proto-production": "http://localhost:5181/manufacturing-dashboard-responsive.html#production",
  "proto-inbound": "http://localhost:5181/manufacturing-dashboard-responsive.html#inbound",
  "proto-outbound": "http://localhost:5181/manufacturing-dashboard-responsive.html#outbound",
  "proto-workbench-admin": "http://localhost:5181/workbench-admin.html",
  "proto-workbench-sales": "http://localhost:5181/workbench-sales.html",
  "proto-workbench-warehouse": "http://localhost:5181/workbench-warehouse.html",
};

const selected = targets.length > 0 ? targets : Object.keys(PAGES);
mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-first-run", "--disable-extensions", "--hide-scrollbars", "--force-device-scale-factor=1"],
});

const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });

for (const name of selected) {
  const url = PAGES[name.replace(/-bottom$/, "")];
  if (!url) {
    console.error(`未知目标: ${name}`);
    continue;
  }
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 2200));
  if (name.endsWith("-bottom")) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  const file = `${OUT_DIR}${name}.png`;
  await page.screenshot({ path: file });
  console.log(`saved ${file}`);
}

await browser.close();
