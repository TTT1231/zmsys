import { describe, expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import type { AuthUser } from '../common/types/auth-user';

const actor: AuthUser = {
    id: '1',
    account: 'guojun',
    name: '郭均',
    role: 'super',
    isSuper: true,
    rowVersion: 1,
    permissions: new Set(),
};

function createController() {
    const service = {
        login: vi.fn().mockResolvedValue({ accessToken: 't', user: {} }),
        getProfile: vi.fn().mockResolvedValue({ user: {}, grant: {} }),
        changePassword: vi.fn().mockResolvedValue(null),
    } as unknown as AuthService;
    return { controller: new AuthController(service), service };
}

describe('AuthController', () => {
    it('login 委托 service 并透传 DTO', async () => {
        const { controller, service } = createController();
        const dto = { account: 'guojun', password: '123456' };
        await controller.login(dto);
        expect(service.login).toHaveBeenCalledWith(dto);
    });

    it('logout 是幂等公开端点，直接返回 null', () => {
        const { controller } = createController();
        expect(controller.logout()).toBeNull();
    });

    it('changePassword 返回 null 信封数据', async () => {
        const { controller } = createController();
        await expect(
            controller.changePassword(actor, {
                oldPassword: 'a123456',
                newPassword: 'b123456',
            }),
        ).resolves.toBeNull();
    });
});
