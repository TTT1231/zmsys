/* 临时脚本：为 e2e 准备专属库 dbtest1_test（生产备份 + 两个新迁移 + 已知密码），跑完即删 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { config } from "dotenv";

config({ path: ["../../.env", ".env"] });

const DUMP = "C:\\Users\\Tu1231\\Desktop\\zmsys\\scripts\\backups\\zmdb-20260927-094715.sql.gz";
const DB = "dbtest1_test";

const mariadb = await import("mariadb");
const base = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
};
const admin = await mariadb.createConnection(base);
await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``);
await admin.query(`CREATE DATABASE \`${DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
await admin.end();

const conn = await mariadb.createConnection({ ...base, database: DB, multipleStatements: true });
await conn.query(gunzipSync(readFileSync(DUMP)).toString("utf8"));
console.log("restored to", DB);
await conn.end();

// 开发库的已知密码哈希（生产 guojun 已改密，e2e 登录用 123456）
const dev = await mariadb.createConnection({ ...base, database: "zmdb" });
const hash = (await dev.query("SELECT password_hash FROM sys_user WHERE account='guojun'"))[0].password_hash;
await dev.end();
const copy = await mariadb.createConnection({ ...base, database: DB });
await copy.query("UPDATE sys_user SET password_hash=? WHERE account='guojun'", [hash]);
console.log("password synced");
await copy.end();
