import { envSchema, type FrontendEnv } from "./env.schema";

/* 键级直接成员访问是 Vite 官方保证构建期静态替换的写法：赋值给中间变量再取
 * import.meta.env 整体不会被打平替换，产物会退化为运行时取值而丢失配置。
 * satisfies 锚定 schema 键集：漏键/拼错键编译期即报错，否则 parse 会静默走 default */
const raw = {
    VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
} satisfies Record<keyof FrontendEnv, string | undefined>;

/** 全站唯一取用口：业务代码不得直接读 import.meta.env，键名拼错编译期即报错；
 * 非法值在模块加载时抛错，不静默兜底到错误配置 */
export const env: FrontendEnv = envSchema.parse(raw);
