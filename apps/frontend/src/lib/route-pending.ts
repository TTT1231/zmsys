/* 路由加载信号:模块级极简 store。由 routeLevel 的 PageLoading 挂载/卸载驱动
   (覆盖懒加载 chunk、认证校验等路由级场景),引用计数让多个加载源并存时互不覆盖,
   RouteProgressBar 订阅消费,与 React 渲染周期解耦 */
let count = 0;
const listeners = new Set<() => void>();

/* 只在跨越 0 边界时通知,订阅方无需关心并发加载源的数量 */
function notifyIfBoundaryCrossed(wasPending: boolean) {
    if (wasPending !== count > 0) listeners.forEach(listener => listener());
}

export function enterRoutePending() {
    const wasPending = count > 0;
    count += 1;
    notifyIfBoundaryCrossed(wasPending);
}

export function exitRoutePending() {
    const wasPending = count > 0;
    count = Math.max(0, count - 1);
    notifyIfBoundaryCrossed(wasPending);
}

export function isRoutePending() {
    return count > 0;
}

export function subscribeRoutePending(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/* 强制清零:仅供测试在用例间恢复初始态 */
export function resetRoutePending() {
    count = 0;
}
