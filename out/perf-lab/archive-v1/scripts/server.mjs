/* 静态 dist + /api 反代小服务器（node:http，无外部依赖）。
 *
 * 背景：实测 vite preview 在 vite 8 下确实继承 server.proxy（见 run-sweep envNotes），
 * 但 preview 经 pnpm 包装、进程树不干净；harness 需要单进程 spawn/kill 的可控服务，
 * 故自写：静态服务 apps/frontend/dist，/api/* 反代到 127.0.0.1:5000 的真实后端。
 * 静态文本资源按 Accept-Encoding 提供 gzip（对齐生产 nginx 行为）；API 原样透传。 */
import http from "node:http";
import { createReadStream } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const args = new Map(
    process.argv
        .slice(2)
        .map((v, i, a) => (i % 2 === 0 ? [v.replace(/^--/, ""), a[i + 1]] : []))
        .filter(e => e.length),
);
const PORT = args.get("port") === undefined ? NaN : Number(args.get("port"));
const ROOT = args.get("root");
const API_ORIGIN = args.get("api") ?? "http://127.0.0.1:5000";
if (!Number.isInteger(PORT) || !ROOT) {
    console.error("usage: node server.mjs --port <p> --root <distDir> [--api <origin>]");
    process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "..", "..");
const DIST = path.isAbsolute(ROOT) ? ROOT : path.resolve(REPO, ROOT);

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".map": "application/json",
    ".txt": "text/plain; charset=utf-8",
};

function proxy(req, res) {
    const target = new URL(req.url, API_ORIGIN);
    const headers = { ...req.headers };
    headers.host = target.host;
    const upstream = http.request(
        {
            protocol: target.protocol,
            hostname: target.hostname,
            port: target.port,
            path: target.pathname + target.search,
            method: req.method,
            headers,
        },
        up => {
            res.writeHead(up.statusCode ?? 502, up.headers);
            up.pipe(res);
        },
    );
    upstream.on("error", err => {
        if (!res.headersSent) res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ code: 502, message: `perf-lab proxy error: ${err.message}` }));
    });
    req.pipe(upstream);
}

async function serveStatic(req, res) {
    const url = new URL(req.url, "http://localhost");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.includes("\0")) {
        res.writeHead(400).end("bad path");
        return;
    }
    let file = path.normalize(path.join(DIST, pathname));
    if (!file.startsWith(DIST)) {
        res.writeHead(403).end("forbidden");
        return;
    }
    let st = await stat(file).catch(() => null);
    if (st?.isDirectory() || !st) {
        // SPA 回退：无扩展名路径（路由）回 index.html；带扩展名但不存在 → 404
        const hasExt = path.extname(pathname) !== "";
        if (hasExt && !st) {
            res.writeHead(404).end("not found");
            return;
        }
        file = path.join(DIST, "index.html");
        st = await stat(file).catch(() => null);
        if (!st) {
            res.writeHead(500).end("index.html missing");
            return;
        }
    }
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] ?? "application/octet-stream";
    const acceptsGzip = /\bgzip\b/.test(req.headers["accept-encoding"] ?? "");
    const compressible = [".html", ".js", ".mjs", ".css", ".svg", ".json", ".txt", ".map"].includes(ext);
    const baseHeaders = {
        "content-type": type,
        // index.html 不缓存（对齐生产：发版后要能拿到新入口）；hash 资源允许缓存
        "cache-control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
    };
    if (pathname === "/" || path.basename(file) === "index.html") {
        // 每次入口都可能被 sweep 重置，入口 HTML 用内存内容 + gzip
        const buf = await readFile(file);
        if (acceptsGzip && compressible) {
            const gz = zlib.gzipSync(buf);
            res.writeHead(200, { ...baseHeaders, "content-encoding": "gzip", "content-length": gz.length });
            res.end(gz);
        } else {
            res.writeHead(200, { ...baseHeaders, "content-length": buf.length });
            res.end(buf);
        }
        return;
    }
    if (acceptsGzip && compressible) {
        // 流式 gzip；content-length 未知用 chunked
        res.writeHead(200, { ...baseHeaders, "content-encoding": "gzip" });
        createReadStream(file)
            .pipe(zlib.createGzip({ level: 6 }))
            .pipe(res);
    } else {
        res.writeHead(200, { ...baseHeaders, "content-length": st.size });
        createReadStream(file).pipe(res);
    }
}

const server = http.createServer((req, res) => {
    if (req.url.startsWith("/api/")) {
        proxy(req, res);
        return;
    }
    serveStatic(req, res).catch(err => {
        if (!res.headersSent) res.writeHead(500);
        res.end(String(err?.stack ?? err));
    });
});

server.listen(PORT, "127.0.0.1", () => {
    process.stdout.write(
        `perf-lab static server ready on http://127.0.0.1:${server.address().port} root=${DIST} api=${API_ORIGIN}\n`,
    );
});
