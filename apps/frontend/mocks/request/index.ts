import { bomHandlers, customerHandlers, ledgerHandlers, orderHandlers } from "./business";

// auth / roles / users 已切换真实后端（vite.config.ts 的 /api 代理 → zmsys-backend）：
// 对应 handler 移出注册表即可——worker 以 bypass 策略运行，未注册路由自动穿透到代理。
// handler 实现仍保留在同目录 auth.ts / system.ts，便于业务端点逐个切换时参考与回退。
export const handlers = [...orderHandlers, ...customerHandlers, ...bomHandlers, ...ledgerHandlers];
