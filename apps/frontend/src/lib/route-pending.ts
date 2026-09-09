/* 路由加载信号:模块级极简 store。由 PageLoading 挂载/卸载驱动(覆盖懒加载 chunk、
   认证校验等场景),RouteProgressBar 轮询消费,与 React 渲染周期解耦 */
let pending = false;
const listeners = new Set<() => void>();

export function setRoutePending(value: boolean) {
    if (pending === value) return;
    pending = value;
    listeners.forEach(listener => listener());
}

export function isRoutePending() {
    return pending;
}

export function subscribeRoutePending(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
