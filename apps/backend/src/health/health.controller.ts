import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { Public } from "../common/decorators/public.decorator";
import { PrismaService } from "../prisma/prisma.service";

/** 存活/就绪探针：无鉴权，供编排系统与冒烟脚本使用 */
@Controller("health")
export class HealthController {
    constructor(private readonly prisma: PrismaService) {}

    /** 存活探针：进程活着即 200，不触数据库 */
    @Public()
    @Get("live")
    live(): { status: string } {
        return { status: "ok" };
    }

    /** 就绪探针：数据库探活（SELECT 1），失败返回 503 */
    @Public()
    @Get("ready")
    async ready(): Promise<{ status: string }> {
        try {
            await this.prisma.$queryRaw`SELECT 1`;
        } catch {
            throw new ServiceUnavailableException("数据库不可用");
        }
        return { status: "ok" };
    }
}
