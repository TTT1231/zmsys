# ---- 构建阶段：pnpm install（postinstall 自动 prisma generate）+ nest build ----
# 用 debian slim 而非 alpine：typescript 原生二进制对 musl 的支持不稳定（与前端 Dockerfile 同因）
FROM node:24-slim AS build
WORKDIR /app

# npm registry 构建时可注入内网镜像加速，默认官方源
ARG NPM_REGISTRY=https://registry.npmjs.org/
ENV NPM_CONFIG_REGISTRY=$NPM_REGISTRY
RUN npm install -g pnpm@11
# 镜像内没有 .git，HUSKY=0 跳过 prepare 钩子安装
ENV HUSKY=0

# 先拷 manifest 与 schema（postinstall 的 prisma generate 依赖 schema），单独成层吃缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ---- 运行阶段 ----
# 迁移 CLI（prisma）与 seed 运行器（tsx）均为 devDependencies，故拷全量
# node_modules 而非 --prod 精简：镜像换大，换取 migrate/seed 直接可用。
# .env 已被 .dockerignore 排除，配置一律由容器环境变量注入（compose environment）
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./

# 启动即迁移（migrate deploy 幂等：已应用的迁移直接跳过），随后起服务
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/main.js"]
