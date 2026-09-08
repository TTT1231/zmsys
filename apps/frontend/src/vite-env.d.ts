/// <reference types="vite/client" />

interface ImportMetaEnv {
    /** API 基础路径，默认 /api（联调真实后端时指向其地址或走代理） */
    readonly VITE_API_BASE_URL?: string;
    /** 设为 "false" 时开发模式也不启用 MSW（联调真实后端用） */
    readonly VITE_ENABLE_MSW?: string;
}
