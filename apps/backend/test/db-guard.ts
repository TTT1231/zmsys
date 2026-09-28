/**
 * e2e 测试库安全护栏：任何 e2e spec 必须最先 import 本文件。
 * 双条件强制：NODE_ENV=test 且库名以 _test 结尾；二者缺一即拒绝运行，
 * 绝不允许测试触碰开发库（zmdb）。
 */
import { config } from "dotenv";
import { deriveTestDatabase, loadDbEnv } from "../src/configuration/raw-env";

// vitest 从本包 cwd 运行：仓库根 .env 优先，包内 .env 兜底（修掉裸 dotenv/config 只读 cwd 的盲区）
config({ path: ["../../.env", ".env"] });

// 测试库名由开发库名派生（加 _test 后缀）；已带后缀则尊重显式配置
const testDatabase = deriveTestDatabase(loadDbEnv().database);

process.env.NODE_ENV = "test";
process.env.DB_DATABASE = testDatabase;

export const TEST_DATABASE = testDatabase;

/** 二次断言：连接建立后再核对一次实际连接的库名（用于任何重建/重置操作前） */
export const assertTestDatabase = (databaseName: string): void => {
    if (process.env.NODE_ENV !== "test" || !databaseName.endsWith("_test")) {
        throw new Error(
            `安全断言失败：仅允许操作 *_test 库（NODE_ENV=test），当前 ${process.env.NODE_ENV}/${databaseName}`,
        );
    }
};
