import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RolesModule } from '../roles/roles.module';
import type { AppConfig } from '../configuration';

@Module({
    imports: [
        RolesModule,
        JwtModule.registerAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService<AppConfig>) => ({
                secret: config.getOrThrow('jwt.secret', { infer: true }),
                signOptions: {
                    // StringValue 模板字面量类型（"8h" 等 ms 格式），运行时仍是字符串
                    expiresIn: config.getOrThrow('jwt.expiresIn', { infer: true }) as JwtSignOptions['expiresIn'],
                    issuer: config.getOrThrow('jwt.issuer', { infer: true }),
                    audience: config.getOrThrow('jwt.audience', { infer: true }),
                },
            }),
        }),
    ],
    providers: [AuthService, JwtStrategy],
    controllers: [AuthController],
})
export class AuthModule {}
