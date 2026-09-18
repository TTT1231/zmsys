import { isFunction } from "./is";

/**
 * 将实例原型上的方法绑定到实例自身，使方法可以安全地作为回调传递
 */
function bindMethods<T extends object>(instance: T): void {
    const prototype = Object.getPrototypeOf(instance);
    if (!prototype) {
        return;
    }
    for (const prop of Object.getOwnPropertyNames(prototype)) {
        const value = (instance as any)[prop];
        if (prop !== "constructor" && isFunction(value)) {
            (instance as any)[prop] = value.bind(instance);
        }
    }
}

export { bindMethods };
