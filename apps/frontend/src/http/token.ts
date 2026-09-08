/* accessToken 存取：独立微模块，避免 auth.ts 与 client.ts 循环引用 */
const TOKEN_KEY = "zm-token";

export function getToken(): string | null {
    try {
        return localStorage.getItem(TOKEN_KEY);
    } catch {
        return null;
    }
}

export function setToken(token: string): void {
    try {
        localStorage.setItem(TOKEN_KEY, token);
    } catch {
        // 存储失败仅影响下次进入的登录态
    }
}

export function clearToken(): void {
    try {
        localStorage.removeItem(TOKEN_KEY);
    } catch {
        // 同上
    }
}
