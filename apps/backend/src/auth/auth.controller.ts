import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from '../common/decorators/public.decorator';
import { AuthenticatedOnly } from '../common/decorators/authenticated-only.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { LoginThrottleGuard } from '../common/guards/login-throttle.guard';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import type { AuthUser } from '../common/types/auth-user';
import type { RoleGrant, WbUser } from '../access-control/types';

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @Public()
    @UseGuards(LoginThrottleGuard)
    @Post('login')
    @HttpCode(HttpStatus.OK) // openapi 契约为 200，覆盖 @Post 默认的 201
    async login(@Body() dto: LoginDto): Promise<{ accessToken: string; user: WbUser }> {
        return this.authService.login(dto);
    }

    /** 幂等退出：JWT 不落库，客户端清理本地 token 即可，即使 token 已过期也返回成功 */
    @Public()
    @Post('logout')
    @HttpCode(HttpStatus.OK)
    logout(): null {
        return null;
    }

    @AuthenticatedOnly()
    @Get('profile')
    async getProfile(@CurrentUser() user: AuthUser): Promise<{ user: WbUser; grant: RoleGrant }> {
        return this.authService.getProfile(user);
    }

    @AuthenticatedOnly()
    @Put('profile')
    async updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto): Promise<WbUser> {
        return this.authService.updateProfile(user, dto);
    }

    @AuthenticatedOnly()
    @Put('password')
    async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto): Promise<null> {
        return this.authService.changePassword(user, dto);
    }
}
