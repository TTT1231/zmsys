import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { AI_DOC_ROOT_FILE, AI_DOC_TOPICS } from "./ai-docs-topics";
import type { AiDocContent, AiDocsManifest } from "./types";

/**
 * agent 文档读取（契约 /ai/agent/docs*）：正文单一归属在仓库 docs/ 下，运行时按
 * 仓库布局解析——开发进程 cwd 为 apps/backend、容器为 /app/apps/backend，两者
 * ../../docs 均指向仓库 docs（部署镜像由 Dockerfile.backend COPY docs 保证存在，
 * staging/dockerignore 已同步放行）。不缓存：文档量级 KB，逐请求读取避免部署后
 * 读到旧缓存。
 */
@Injectable()
export class AiDocsService {
    private readonly docsRoot = join(process.cwd(), "..", "..", "docs");

    async getManifest(): Promise<AiDocsManifest> {
        const root = await this.readDoc(AI_DOC_ROOT_FILE, "根文档缺失");
        return {
            root,
            topics: AI_DOC_TOPICS.map(({ id, title, whenToUse }) => ({ id, title, whenToUse })),
        };
    }

    async getTopic(topicId: string): Promise<AiDocContent> {
        const topic = AI_DOC_TOPICS.find(item => item.id === topicId);
        if (!topic) {
            throw new NotFoundException(`未知的文档主题：${topicId}`);
        }
        return {
            id: topic.id,
            title: topic.title,
            markdown: await this.readDoc(topic.file, `文档 ${topic.file} 缺失`),
        };
    }

    private async readDoc(relativeFile: string, missingHint: string): Promise<string> {
        try {
            return await readFile(join(this.docsRoot, relativeFile), "utf8");
        } catch (error) {
            // 目录整体缺失大概率是部署镜像没带 docs（本地开发与 e2e 不会走到这里）
            throw new ServiceUnavailableException(`AI 文档不可用（${missingHint}；请检查部署镜像是否包含 docs 目录）`, {
                cause: error,
            });
        }
    }
}
