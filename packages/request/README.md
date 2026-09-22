# @zmsys/request

## 概述

使用本包可构造带拦截器管理、文件上传下载与 SSE 流式请求的 axios 客户端。请求方法与 axios 一致；响应返回形态由 `responseReturn` 决定（`raw` 原始响应 / `body` 响应体 / `data` 信封数据节点），数组查询参数可按四种 qs 风格序列化。三个预设拦截器工厂分别承担 `{code, data, message}` 信封解包、401 刷新 token 排队重放、HTTP 错误文案归一化。包同时 re-export 整个 axios，消费方无需再依赖 axios 本体。本包只提供客户端与预设件，不组装业务实例——token 注入、信封约定与登出跳转属于应用层。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

---

<a id="use-this-package"></a>

## 使用本包

本包交付的是可组装的客户端：应用层构造一个 `RequestClient` 单例并注册横切拦截器，业务代码只引用该实例。新增能力时按下表选择入口：

| 你要写的东西                      | 使用                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------- |
| 普通 JSON 请求                    | `client.get / post / put / patch / delete`                                       |
| 需要读取 headers、status 或文件流 | 保持默认 `responseReturn: "raw"`，拿到 `AxiosResponse`                           |
| 上传文件                          | `client.upload(url, { file, ...附带字段 })`                                      |
| 下载文件                          | `client.download(url)`，默认返回 `Blob`                                          |
| AI 对话等流式响应                 | `client.postSSE(url, data, { onMessage, onEnd })`                                |
| 数组查询参数                      | config 传 `paramsSerializer: "brackets" / "comma" / "indices" / "repeat"`        |
| 刷新 token、错误提示等横切逻辑    | `client.addRequestInterceptor / addResponseInterceptor` 注册，或用预设拦截器工厂 |

### 创建实例

```ts
const client = new RequestClient({
    baseURL: "/api",
    timeout: 15_000, // 包内默认 10s
});
```

options 类型为 `CreateAxiosDefaults & ExtendOptions`，构造默认值：`Content-Type: application/json;charset=utf-8`、`responseReturn: "raw"`、`timeout: 10_000`。

### responseReturn

实例级与请求级 config 均可设置，请求级覆盖实例级：

- `"raw"`（默认）：原始 `AxiosResponse`，不做成功检查。
- `"body"`：只返回响应 BODY，仅按 HTTP status（2xx–3xx）判成功，业务 code 由调用方检查。
- `"data"`：解构 BODY 的 `data` 节点，同时检查 status 与业务 code。

`responseReturn` 只是传给响应拦截器的标记，解包逻辑由拦截器实现——包内的默认实现是 `defaultResponseInterceptor`，消费方也可在自定义拦截器中读取同一约定。未注册实现该约定的拦截器时，无论取何值都返回原始 `AxiosResponse`。

### 拦截器

`addRequestInterceptor({ fulfilled, rejected })` 与 `addResponseInterceptor({ fulfilled, rejected })` 直接映射 axios interceptors，注册顺序即执行顺序。**响应拦截器 fulfilled 的返回值就是调用方拿到的值**，解包、错误归一化都发生在这里。

三个预设工厂（返回 `ResponseInterceptorConfig`，按需 `addResponseInterceptor` 注册）：

- `defaultResponseInterceptor({ codeField = "code", dataField = "data", successCode = 0 })`——实现上表 `responseReturn` 取值约定；`dataField` 可为字段名或 `(responseData) => any` 函数，`successCode` 可为值或 `(code) => boolean` 谓词。
- `authenticateResponseInterceptor({ client, doReAuthenticate, doRefreshToken, enableRefreshToken, formatToken })`——非 401 错误直接抛出；401 且关闭刷新或已是重试请求时 `doReAuthenticate()` 后抛出；刷新期间并发的 401 进入 `client.refreshTokenQueue` 排队，刷新成功后以新 token 重放，失败则清空队列并重新认证。
- `errorMessageResponseInterceptor(makeErrorMessage?)`——`isCancel` 透传；Network Error / timeout 特判；其余按 status 映射内置中文文案（400/401/403/404/408/其他），经 `makeErrorMessage(message, error)` 回调交给调用方展示。

### 上传与下载

`upload(url, data, config?)` 把 `data: Record<string, any> & { file: Blob | File }` 整体转为 FormData：数组值按 `key[0]`、`key[1]` 追加，`undefined` 值跳过，`Content-Type` 强制 `multipart/form-data`（可被传入 headers 覆盖）。

`download(url, config?)` 强制 `responseType: "blob"`，默认 GET、`responseReturn: "body"` 返回 `Blob`；传 `responseReturn: "raw"` 返回完整响应以便从 headers 读取文件名；`method` 可覆盖（POST 下载）。

### SSE

基于 `fetch` + `ReadableStream` 而非 `EventSource`，因此支持 POST body：

```ts
await client.postSSE(
    "/chat/stream",
    { prompt },
    {
        onMessage: chunk => {
            /* 解码后的文本片段 */
        },
        onEnd: () => {},
    },
);
```

`requestSSE(url, data?, requestOptions?)` 为通用入口，`requestOptions` 是 `RequestInit` 的扩展（`SseRequestOptions`），可指定 `method`。url 与 `baseURL` 自动拼接（绝对 url 原样保留）。

---

<a id="understand-the-implementation"></a>

## 理解实现

### 设计理念

**泛型是拦截器处理后的值。** 所有请求方法收敛到 `request<T>()`，其返回 `response as T`——`T` 不是响应体类型：默认 `raw` 且无解包拦截器时是 `AxiosResponse<T>`，注册解包拦截器后即业务数据类型。

**方法已绑定实例。** 构造时经 `bindMethods` 绑定，`upload`、`download`、`postSSE` 等可安全解构传递，内部模块（`FileUploader` / `FileDownloader` / `SSE` / `InterceptorManager`）持同一 client 引用而非复制配置。

**SSE 复用请求拦截器链。** SSE 不走 axios，而是手动顺序执行实例上已注册的请求拦截器（仅 `fulfilled`），把结果并入 fetch headers——token 注入等逻辑对流式请求同样生效。未显式设置时自动补 `accept: text/event-stream`；`content-type` 为 JSON 时对象 body 自动 `JSON.stringify`（`ArrayBuffer` / TypedArray / `Blob` / `FormData` 原样传递）。

**paramsSerializer 双入口转换。** 构造配置与每次请求的 config 中的字符串预设（`"brackets"` / `"comma"` / `"indices"` / `"repeat"`）都经 `getParamsSerializer` 转为 `qs.stringify` 包装，原生函数形式原样透传。

### 源码地图

| 文件                                        | 承载                                                             |
| ------------------------------------------- | ---------------------------------------------------------------- |
| `src/index.ts`                              | 对外出口：re-export `request-client` 与整个 axios                |
| `src/request-client/request-client.ts`      | `RequestClient` 类：方法、默认配置、模块组装、`bindMethods`      |
| `src/request-client/types.ts`               | 全部导出类型；`responseReturn` / `paramsSerializer` 扩展定义于此 |
| `src/request-client/preset-interceptors.ts` | 三个预设响应拦截器工厂与内置中文文案                             |
| `src/request-client/modules/interceptor.ts` | `InterceptorManager`：注册逻辑，直接映射 axios interceptors      |
| `src/request-client/modules/uploader.ts`    | `FileUploader`：FormData 组装与数组字段序列化                    |
| `src/request-client/modules/downloader.ts`  | `FileDownloader`：blob 下载与多 method 分发                      |
| `src/request-client/modules/sse.ts`         | `SSE`：fetch 流式读取、拦截器链复用、`safeJoinUrl`               |

---

<a id="further-exploration"></a>

## 进一步探索

- `@zmsys/utils`——本包声明的运行时依赖（`package.json` → `workspace:*`）：`bindMethods` / `merge` / `isString` / `isFunction` / `isUndefined` 均来自该包。

---

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与延期工作

这些限制界定了本包不适用的场景，属于当前的包级约束。

- **SSE 不解析帧**——`onMessage` 收到的是 `TextDecoder` 解码后的原始文本 chunk，`data:` 前缀与事件边界由调用方自行处理。
- **`download` 不支持 `responseReturn: "data"`**——其 config 类型已 `Omit` 掉该分支，只有 `body` / `raw` 两种形态。
- **`defaultResponseInterceptor` 失败时抛非 Error 对象**——`throw Object.assign({}, response, { response })` 是普通对象合并，调用方不能假设 `instanceof Error`。
- **错误文案硬编码中文**——`httpErrorMessages` 内置于包内，国际化需在外层替换该预设。
- **`authenticateResponseInterceptor` 依赖实例公开状态**——直接读写 `client.isRefreshing` / `client.refreshTokenQueue`，刷新失败时队列以空 token 回调（`formatToken("")` 的返回值会写入 `Authorization`）。

---

<a id="dev-note"></a>

### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

- `exports` 直指 `src/index.ts` 源码，无构建产物，改动即生效；消费方重跑 typecheck / dev server 即可。
- 包内命令：`pnpm test`（vitest run，覆盖 request-client 与 uploader / downloader / sse，mock 用 axios-mock-adapter）、`pnpm typecheck`（tsc）。
- 三个预设拦截器是可选件，不构成本包行为的一部分：消费方可完全自定义拦截器替代之，此时修改预设不影响其行为；反之亦然。

</details>
