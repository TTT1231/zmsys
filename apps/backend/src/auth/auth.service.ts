import { randomUUID } from "node:crypto";
import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { TransactionRunner } from "../prisma/transaction.runner";
import type { Tx } from "../prisma/transaction.runner";
import { SnowflakeGenerator } from "../common/snowflake";
import { AccessControlService } from "../access-control/access-control.service";
import { toWbUser, userSnapshot, writeUserChangeLog } from "../access-control/wb-user";
import { lockRowsById } from "../domain/concurrency";
import type { RoleGrant, WbUser } from "../access-control/types";
import type { AuthUser } from "../common/types/auth-user";
import type { JwtPayload } from "./types";
import type { LoginDto } from "./dto/login.dto";
import type { ChangePasswordDto } from "./dto/change-password.dto";

/** 账号不存在时也执行一次同代价比较，避免响应时间泄露账号是否存在 */
const DUMMY_HASH = bcrypt.hashSync("timing-attack-dummy-password", 10);

@Injectable()
export class AuthService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly jwtService: JwtService,
        private readonly accessControl: AccessControlService,
        private readonly snowflake: SnowflakeGenerator,
        private readonly txRunner: TransactionRunner,
    ) {}

    async login(dto: LoginDto): Promise<{ accessToken: string; user: WbUser }> {
        const user = await this.prisma.sysUser.findUnique({
            where: { account: dto.account },
        });
        const passwordOk = await bcrypt.compare(dto.password, user?.passwordHash ?? DUMMY_HASH);
        // 凭据错误与账号停用统一文案，不泄露账号存在性
        if (!user || !passwordOk || !user.status) {
            throw new BadRequestException("账号或密码错误");
        }

        const now = new Date();
        await this.prisma.sysUser.update({
            where: { id: user.id },
            // 登录只更新 last_login_at；显式回写 updated_at 旧值，压制全局扩展的
            // 自动注入（prisma-extensions.ts），避免"上一次修改时间"刷成最近登录时间
            // （个人中心展示语义：仅资料/状态/密码变更）
            data: { lastLoginAt: now, updatedAt: user.updatedAt },
        });

        const payload: Pick<JwtPayload, "sub" | "ver"> = {
            sub: user.id.toString(),
            ver: Number(user.tokenVersion),
        };
        const accessToken = await this.jwtService.signAsync(payload, {
            jwtid: randomUUID(),
        });
        return { accessToken, user: toWbUser(user, now) };
    }

    async getProfile(user: AuthUser): Promise<{ user: WbUser; grant: RoleGrant }> {
        // validate 已回查过一次；此处再读一次拿最新的 last_login_at 与 row_version
        const current = await this.prisma.sysUser.findUnique({
            where: { id: BigInt(user.id) },
        });
        if (!current || !current.status) {
            throw new UnauthorizedException("登录已过期，请重新登录");
        }
        const grant = await this.accessControl.getGrant(current.roleCode as WbUser["role"]);
        return { user: toWbUser(current), grant };
    }

    /**
     * 自助修改密码：锁用户行，旧密码校验通过后更新强哈希，
     * 递增 token_version 使全部旧 JWT 立即失效，row_version 同步 +1 并写日志。
     * （姓名等资料为管理员域，走 users 模块的 PUT /users/{account}，无自助改名）
     */
    async changePassword(user: AuthUser, dto: ChangePasswordDto): Promise<null> {
        const userId = BigInt(user.id);
        const newHash = await bcrypt.hash(dto.newPassword, 10);
        await this.txRunner.run(async (tx: Tx) => {
            const now = new Date();
            await lockRowsById(tx, "sys_user", [userId]);
            const current = await tx.sysUser.findUnique({ where: { id: userId } });
            if (!current) {
                throw new BadRequestException("账号不存在或已停用");
            }
            const oldOk = await bcrypt.compare(dto.oldPassword, current.passwordHash);
            if (!oldOk) {
                throw new BadRequestException("旧密码不正确");
            }
            const updated = await tx.sysUser.update({
                where: { id: userId },
                data: {
                    passwordHash: newHash,
                    passwordChangedAt: now,
                    tokenVersion: { increment: 1 },
                    rowVersion: { increment: 1 },
                },
            });
            // 密码事件只记录“已变更”及版本，不记录任何密码材料
            await writeUserChangeLog(tx, this.snowflake, {
                userId,
                operatorId: userId,
                eventType: "PASSWORD_CHANGE",
                now,
                beforeVersion: current.rowVersion,
                afterVersion: updated.rowVersion,
                reason: "自助修改密码",
                beforeJson: userSnapshot(current),
                afterJson: userSnapshot(updated),
            });
        });
        return null;
    }
}
