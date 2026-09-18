# ---- 构建阶段:tsc 类型检查 + vite 产出静态文件 ----
# 用 debian slim 而非 alpine:TS 7 原生二进制对 musl 的支持不稳定
FROM node:24-slim AS build
WORKDIR /app

RUN npm install -g pnpm@10
# 镜像内没有 .git,HUSKY=0 跳过 prepare 钩子安装
ENV HUSKY=0

# 先装依赖,单独成层:package 相关文件不变时命中缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ---- 运行阶段:nginx 托管 dist,/api 反代到后端容器 ----
FROM nginx:stable-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
