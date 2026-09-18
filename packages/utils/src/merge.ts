import { isPlainObject } from "./is";

/**
 * 深度合并多个对象，返回新对象，不修改入参。
 * 靠后的参数优先级更高；值为 undefined 的字段不会覆盖已有值。
 */
function merge<T extends Record<string, any>>(...sources: T[]): T {
    const result: Record<string, any> = {};
    for (const source of sources) {
        for (const key of Object.keys(source)) {
            const value = source[key];
            if (value === undefined) {
                continue;
            }
            const existing = result[key];
            result[key] = isPlainObject(existing) && isPlainObject(value) ? merge(existing, value) : value;
        }
    }
    return result as T;
}

export { merge };
