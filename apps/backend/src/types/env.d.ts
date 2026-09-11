declare namespace NodeJS {
    interface ProcessEnv {
        NODE_ENV: 'development' | 'production' | 'test';
        HOST: string;
        PORT: string;
        DB_HOST: string;
        DB_PORT: string;
        DB_USERNAME: string;
        DB_PASSWORD: string;
        DB_DATABASE: string;
        JWT_SECRET: string;
        JWT_EXPIRES_IN: string;
        JWT_ISSUER: string;
        JWT_AUDIENCE: string;
        SNOWFLAKE_WORKER_ID: string;
        CORS_ORIGINS: string;
    }
}
