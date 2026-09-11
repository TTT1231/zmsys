import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { SUPER_ROLE_CODE, isRoleCode, type RoleCode } from '../../constants';
import type { AppConfig } from '../../configuration';
import type { AuthUser } from '../../common/types/auth-user';
import type { JwtPayload } from '../types';

/**
 * JWT 只证明会话身份：签名、有效期、签发者与受众通过后，
 * 仍按 sub 回查 sys_user 确认启停状态、token_version 与实时授权。
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(
        configService: ConfigService<AppConfig>,
        private readonly prisma: PrismaService,
    ) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: configService.getOrThrow('jwt.secret', { infer: true }),
            issuer: configService.getOrThrow('jwt.issuer', { infer: true }),
            audience: configService.getOrThrow('jwt.audience', { infer: true }),
        });
    }

    async validate(payload: JwtPayload): Promise<AuthUser> {
        const user = await this.prisma.sysUser.findUnique({
            where: { id: BigInt(payload.sub) },
        });
        // 停用或 token_version 落后的旧 JWT 立即拒绝
        if (!user || !user.status || user.tokenVersion !== BigInt(payload.ver)) {
            throw new UnauthorizedException('登录已过期，请重新登录');
        }

        const isSuper = user.roleCode === SUPER_ROLE_CODE;
        const grants = isSuper
            ? []
            : await this.prisma.sysGrant.findMany({
                  where: { roleCode: user.roleCode },
                  select: { permissionCode: true },
              });

        const role: RoleCode = isRoleCode(user.roleCode) ? user.roleCode : 'staff';
        return {
            id: user.id.toString(),
            account: user.account,
            name: user.name,
            role,
            isSuper,
            rowVersion: Number(user.rowVersion),
            // super 不依赖授权行，服务端固定视为全量权限
            permissions: new Set(grants.map(grant => grant.permissionCode)),
        };
    }
}
