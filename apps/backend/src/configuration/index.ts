/** 应用配置结构：ConfigService<AppConfig> 据此提供 key 补全与编译期检查 */
export interface AppConfig {
    nodeEnv: NodeEnv;
    server: {
        host: string;
        port: number;
    };
    database: {
        host: string;
        port: number;
        user: string;
        password: string;
        name: string;
    };
    jwt: {
        secret: string;
        expiresIn: string;
        issuer: string;
        audience: string;
    };
    snowflake: {
        workerId: number;
    };
    cors: {
        origins: string[];
    };
}

type NodeEnv = "development" | "production" | "test";

const NODE_ENVS: readonly NodeEnv[] = ["development", "production", "test"];
/** 未显式设置 NODE_ENV 时的兜底：dist 产物即生产构建，默认按生产运行；
    开发/测试须显式声明（契约：根 .env 里 NODE_ENV=development） */
export const DEFAULT_NODE_ENV: NodeEnv = "production";
const SNOWFLAKE_WORKER_ID_MAX = 1023;

/** 必填字符串：缺失即记录错误，不静默给默认值 */
const required = (key: string, errors: string[]): string => {
    const value = process.env[key]?.trim();
    if (!value) {
        errors.push(`缺少必填环境变量 ${key}`);
    }
    return value ?? "";
};

/** 可选整数：缺省用默认值，给了就必须落在 [min, max] */
const optionalInt = (
    key: string,
    raw: string | undefined,
    fallback: number,
    min: number,
    max: number,
    errors: string[],
): number => {
    if (raw === undefined || raw === "") {
        return fallback;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
        errors.push(`${key} 必须是 ${min}-${max} 的整数，当前为 ${raw}`);
        return fallback;
    }
    return parsed;
};

/**
 * 启动即校验全部环境变量：先收集所有缺失/非法项再一次报错，
 * 避免漏配拖到运行期才以难排查的方式暴露。
 */
export default (): AppConfig => {
    const errors: string[] = [];

    const nodeEnvRaw = process.env.NODE_ENV ?? DEFAULT_NODE_ENV;
    if (!NODE_ENVS.includes(nodeEnvRaw as NodeEnv)) {
        errors.push(`NODE_ENV 必须是 ${NODE_ENVS.join("/")}，当前为 ${nodeEnvRaw}`);
    }
    const nodeEnv = nodeEnvRaw as NodeEnv;
    const isProduction = nodeEnv === "production";

    const jwtSecret = required("JWT_SECRET", errors);
    if (jwtSecret && jwtSecret.length < 32) {
        errors.push(`JWT_SECRET 长度须不少于 32 字符，当前为 ${jwtSecret.length}`);
    }

    // 生产必须显式且全集群唯一；开发默认单实例 1
    let workerIdFallback = 1;
    if (isProduction && !process.env.SNOWFLAKE_WORKER_ID?.trim()) {
        errors.push("生产环境必须显式配置 SNOWFLAKE_WORKER_ID（0-1023，全集群唯一）");
        workerIdFallback = 0;
    }
    const workerId = optionalInt(
        "SNOWFLAKE_WORKER_ID",
        process.env.SNOWFLAKE_WORKER_ID,
        workerIdFallback,
        0,
        SNOWFLAKE_WORKER_ID_MAX,
        errors,
    );

    const serverPort = optionalInt("PORT", process.env.PORT, 5000, 1, 65535, errors);
    const dbHost = required("DB_HOST", errors);
    const dbPort = optionalInt("DB_PORT", process.env.DB_PORT, 3306, 1, 65535, errors);
    const dbUser = required("DB_USERNAME", errors);
    const dbPassword = required("DB_PASSWORD", errors);
    const dbName = required("DB_DATABASE", errors);

    // CORS 白名单：逗号分隔 origin 列表；开发默认放行本机 Vite 端口（契约 servers 为 Vite 代理/MSW）
    const corsOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5173,http://localhost:3000")
        .split(",")
        .map(origin => origin.trim())
        .filter(origin => origin.length > 0);

    if (errors.length > 0) {
        throw new Error(`环境变量校验失败：\n- ${errors.join("\n- ")}`);
    }

    return {
        nodeEnv,
        server: {
            host: process.env.HOST?.trim() || "0.0.0.0",
            port: serverPort,
        },
        database: {
            host: dbHost,
            port: dbPort,
            user: dbUser,
            password: dbPassword,
            name: dbName,
        },
        jwt: {
            secret: jwtSecret,
            expiresIn: process.env.JWT_EXPIRES_IN?.trim() || "8h",
            issuer: process.env.JWT_ISSUER?.trim() || "zmsys-backend",
            audience: process.env.JWT_AUDIENCE?.trim() || "zmsys-admin",
        },
        snowflake: { workerId },
        cors: { origins: corsOrigins },
    };
};
