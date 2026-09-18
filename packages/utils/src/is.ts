function isFunction(value: unknown): value is (...args: any[]) => any {
    return typeof value === "function";
}

function isPlainObject(value: unknown): value is Record<string, any> {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === null || prototype === Object.prototype;
}

function isString(value: unknown): value is string {
    return typeof value === "string";
}

function isUndefined(value: unknown): value is undefined {
    return value === undefined;
}

export { isFunction, isPlainObject, isString, isUndefined };
