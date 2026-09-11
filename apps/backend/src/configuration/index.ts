/** 应用配置结构：ConfigService<AppConfig> 据此提供 key 补全与编译期检查 */
export interface AppConfig {
    port: number;
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
}

const toInt = (value: string | undefined, fallback: number): number => {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) ? parsed : fallback;
};

export default (): AppConfig => {
    if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
        throw new Error('生产环境必须配置 JWT_SECRET');
    }

    return {
        port: toInt(process.env.PORT, 5000),
        database: {
            host: process.env.DB_HOST ?? 'localhost',
            port: toInt(process.env.DB_PORT, 3306),
            user: process.env.DB_USERNAME ?? 'root',
            password: process.env.DB_PASSWORD ?? '',
            name: process.env.DB_DATABASE ?? 'zmdb',
        },
        jwt: {
            secret: process.env.JWT_SECRET ?? 'dev-only-insecure-secret',
            expiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
            issuer: process.env.JWT_ISSUER ?? 'zmsys-backend',
            audience: process.env.JWT_AUDIENCE ?? 'zmsys-admin',
        },
    };
};
