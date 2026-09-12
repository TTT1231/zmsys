/* 临时联调工具：导出 mock BOM 种子为 JSON（供 zmsys-backend scripts/seed-dev-boms.ts 导入 dev 库） */
import { writeFileSync } from "node:fs";
import { db } from "../mocks/data/db.ts";

const rows = db.boms.map(({ code, name, modelCode, specs, unit }) => ({ code, name, modelCode, specs, unit }));
writeFileSync(new URL("../bom-seed.json", import.meta.url), JSON.stringify(rows, null, 2));
console.log(`exported ${rows.length} boms -> bom-seed.json`);
