/// <reference types="vite/client" />

/* 前端 env 类型的唯一事实源是 src/env.schema.ts 的 zod schema，此处按其推导做
   声明合并，避免 schema 与手写 interface 双处维护造成类型漂移；业务代码经
   src/env.ts 取值 */
type FrontendEnv = import("./env.schema").FrontendEnv;

interface ImportMetaEnv extends FrontendEnv {}
