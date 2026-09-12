/**
 * BOM/成品档案集成测试：真实 HTTP 管线 + 真实测试库（*_test 种子数据：
 * 品类目录由迁移播种 5 类，bom_table 为空）。型号带随机前缀避免跨运行判重，
 * 写操作可重复执行；运行前置：pnpm test:db:reset。
 */
import './db-guard';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';

const RUN = Date.now().toString(36);
const accountOf = (name: string): string => `qa_${name}_${RUN}`;
const authHeaders = (token: string) => ({ authorization: `Bearer ${token}` });

describe('BOM/成品档案 (e2e)', () => {
    let app: NestFastifyApplication;
    let prisma: PrismaService;
    let superToken: string;

    const login = async (account: string): Promise<string> => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/auth/login',
            payload: { account, password: '123456' },
        });
        return res.json().data.accessToken;
    };

    const createUser = async (account: string, role: string): Promise<string> => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/users',
            headers: { ...authHeaders(superToken), 'idempotency-key': `e2e-${RUN}-${account}` },
            payload: { name: `联调${account.split('_')[1] ?? '用户'}`, account, role },
        });
        expect(res.statusCode).toBe(200);
        return login(account);
    };

    const createBom = async (payload: Record<string, unknown>, idemKey: string, token = superToken) => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/boms',
            headers: { ...authHeaders(token), 'idempotency-key': idemKey },
            payload,
        });
        return res;
    };

    beforeAll(async () => {
        const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
        configureApp(app);
        await app.init();
        prisma = app.get(PrismaService);
        superToken = await login('guojun');
    });

    afterAll(async () => {
        await app.close();
    });

    it('staff 可看品类目录（bom:view 全角色默认授权）；目录为后端权威（5 类、前缀与宽度、字段元数据）', async () => {
        const staffToken = await createUser(accountOf('staff01'), 'staff');
        const staffList = await app.inject({
            method: 'GET',
            url: '/api/bom-categories',
            headers: authHeaders(staffToken),
        });
        expect(staffList.statusCode).toBe(200);

        const list = await app.inject({ method: 'GET', url: '/api/bom-categories', headers: authHeaders(superToken) });
        expect(list.statusCode).toBe(200);
        const categories = list.json().data;
        expect(categories).toHaveLength(5);
        expect(categories.map((category: { key: string }) => category.key)).toEqual([
            'rotary-switch',
            'xk3',
            'new-micro-switch',
            'old-micro-switch',
            'piano-key-switch',
        ]);
        // seqWidth 为默认 3 时省略；新微动 4 位宽度下发
        expect(categories[0]).toMatchObject({ name: '旋转开关', codePrefix: 'XK2' });
        expect(categories[0]).not.toHaveProperty('seqWidth');
        expect(categories[2]).toMatchObject({ codePrefix: 'KW', seqWidth: 4 });
        // 字段元数据：必填选项字段与固定规格（defaultValue）都在目录内
        const pin = categories[0].fields.find((field: { key: string }) => field.key === '脚位');
        expect(pin).toMatchObject({
            type: 'select',
            required: true,
            options: ['二脚', '三脚', '四脚', '五脚', '六脚'],
        });
        const rod = categories[0].fields.find((field: { key: string }) => field.key === '杆子高度');
        expect(rod).toMatchObject({ type: 'text', defaultValue: '4.8' });
    });

    it('列表全量返回；创建成功：品类内序号续接、固定规格并入、型号大写化、摘要过滤常量', async () => {
        const before = await app.inject({ method: 'GET', url: '/api/boms', headers: authHeaders(superToken) });
        expect(before.statusCode).toBe(200);
        const existing = before.json().data as Array<{ code: string }>;
        const rotaryBefore = existing.filter(bom => bom.code.startsWith('ZMXK2')).length;

        const res = await createBom(
            { name: '旋转开关', modelCode: `  ${RUN}-a  `, specs: { 脚位: '三脚', 档位: '一档', 杆子高度: '6.6' } },
            `e2e-bom-${RUN}-create`,
        );
        expect(res.statusCode).toBe(200);
        const created = res.json().data;
        expect(created.code).toBe(`ZMXK2${String(rotaryBefore + 1).padStart(3, '0')}`);
        // 固定规格以目录为准覆盖客户端值；型号 NFKC+trim+ASCII 大写
        expect(created).toMatchObject({
            name: '旋转开关',
            modelCode: `${RUN.toUpperCase()}-A`,
            unit: '个',
            specs: { 脚位: '三脚', 档位: '一档', 杆子高度: '4.8' },
        });
        expect(created.created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(created.spec).toBe(`${RUN.toUpperCase()}-A · 脚位 三脚 · 档位 一档`);

        const stored = await prisma.bomTable.findUnique({ where: { bomCode: created.code } });
        expect(stored?.modelCode).toBe(`${RUN.toUpperCase()}-A`);
        expect(stored?.spec).toMatchObject({ 脚位: '三脚', 杆子高度: '4.8' });

        const list = await app.inject({ method: 'GET', url: '/api/boms', headers: authHeaders(superToken) });
        const codes = (list.json().data as Array<{ code: string }>).map(bom => bom.code);
        expect(codes).toContain(created.code);
    });

    it('缺幂等键 400；品类不存在 404；未定义字段与选项无效 400', async () => {
        const noKey = await app.inject({
            method: 'POST',
            url: '/api/boms',
            headers: authHeaders(superToken),
            payload: { name: '旋转开关', modelCode: `${RUN}-x`, specs: { 脚位: '二脚' } },
        });
        expect(noKey.statusCode).toBe(400);

        const missing = await createBom(
            { name: '未知品类', modelCode: `${RUN}-x`, specs: { 脚位: '二脚' } },
            `e2e-bom-${RUN}-missing`,
        );
        expect(missing.statusCode).toBe(404);
        expect(missing.json().message).toBe('品类不存在');

        const undefinedField = await createBom(
            { name: '旋转开关', modelCode: `${RUN}-x`, specs: { 未知: 'v' } },
            `e2e-bom-${RUN}-undefined-field`,
        );
        expect(undefinedField.statusCode).toBe(400);
        expect(undefinedField.json().message).toBe('规格中包含当前品类未定义的字段');

        const badOption = await createBom(
            { name: '旋转开关', modelCode: `${RUN}-x`, specs: { 脚位: '百脚', 档位: '一档' } },
            `e2e-bom-${RUN}-bad-option`,
        );
        expect(badOption.statusCode).toBe(400);
        expect(badOption.json().message).toBe('规格值无效：脚位');
    });

    it('新微动跨字段规则：支架/静片规格不一致 400；一致时建档 ZMKW 4 位序号', async () => {
        const mismatch = await createBom(
            {
                name: '新微动',
                modelCode: `${RUN}-micro`,
                specs: {
                    底座: '二脚底座（无挡脚）',
                    按钮高度: '8.5mm',
                    支架: '6.3支架：铜镀银',
                    静片: '4.8静片：铜镀镍',
                    动片: '铜镀银',
                    摆片: '铁镀镍摆片',
                    弹片: '0.12',
                },
            },
            `e2e-bom-${RUN}-gauge`,
        );
        expect(mismatch.statusCode).toBe(400);
        expect(mismatch.json().message).toBe('新微动的支架与静片必须使用相同的 6.3/4.8 规格');

        const ok = await createBom(
            {
                name: '新微动',
                modelCode: `${RUN}-micro`,
                specs: {
                    底座: '二脚底座（无挡脚）',
                    按钮高度: '8.5mm',
                    支架: '4.8支架：铜镀镍',
                    静片: '4.8静片：铜镀镍',
                    动片: '铜镀银',
                    摆片: '铁镀镍摆片',
                    弹片: '0.12',
                },
            },
            `e2e-bom-${RUN}-micro-ok`,
        );
        expect(ok.statusCode).toBe(200);
        expect(ok.json().data.code).toMatch(/^ZMKW\d{4,}$/);
        // 全角括号选项原样落库（NFKC 仅用于判重 hash，不改写存储值）
        expect(ok.json().data.specs.底座).toBe('二脚底座（无挡脚）');
    });

    it('判重 409 返回已有编码（型号大小写不敏感走 ai_ci）；幂等重放返回首次响应', async () => {
        // XK3 的 8 个必填字段全部填入，保证 specs 与品类目录一致
        const xk3Specs = {
            外壳: '圆孔长外壳（茶色）',
            底座: '茶色',
            杆子: '圆轴长杆子',
            小静片: '不电镀',
            半圆静片: '不电镀',
            动片: '不电镀',
            卡线片: '0.15',
            弹簧: '0.45长弹簧',
        };
        const first = await createBom(
            { name: 'XK3', modelCode: `${RUN}-dup`, specs: xk3Specs },
            `e2e-bom-${RUN}-dup-first`,
        );
        expect(first.statusCode).toBe(200);

        // 同品类+同型号（大小写变体）+同规格：uk_bom_identity 语义下视为同一档案
        const dup = await createBom(
            { name: 'XK3', modelCode: `${RUN.toUpperCase()}-DUP`, specs: xk3Specs },
            `e2e-bom-${RUN}-dup-conflict`,
        );
        expect(dup.statusCode).toBe(409);
        expect(dup.json().message).toBe(`BOM 已存在：${first.json().data.code}`);

        // 幂等重放：同键同体返回首次响应
        const replay = await createBom(
            { name: 'XK3', modelCode: `${RUN}-dup`, specs: xk3Specs },
            `e2e-bom-${RUN}-dup-first`,
        );
        expect(replay.statusCode).toBe(200);
        expect(replay.json().data).toEqual(first.json().data);

        // 同键不同体 → 409
        const keyConflict = await createBom(
            { name: 'XK3', modelCode: `${RUN}-dup`, specs: { ...xk3Specs, 外壳: '圆孔长外壳（透明）' } },
            `e2e-bom-${RUN}-dup-first`,
        );
        expect(keyConflict.statusCode).toBe(409);
    });

    it('品类序列首插从存量编码 MAX 续接（ZMKW 与 ZMKW16 相近前缀不互读）', async () => {
        // 种子两行真实形态的存量编码，清空品类序列行迫使 bootstrap 走 MAX 续接
        await prisma.$executeRaw`DELETE FROM biz_sequence WHERE sequence_key LIKE 'bom:%'`;
        await prisma.bomTable.deleteMany({ where: { bomCode: { in: ['ZMKW3744', 'ZMKW16012'] } } });
        const micro = await prisma.bomCategory.findUniqueOrThrow({ where: { categoryKey: 'new-micro-switch' } });
        const old = await prisma.bomCategory.findUniqueOrThrow({ where: { categoryKey: 'old-micro-switch' } });
        const superUser = await prisma.sysUser.findFirstOrThrow({ where: { roleCode: 'super' } });
        const now = new Date();
        await prisma.bomTable.createMany({
            data: [
                {
                    id: 9000000000000001n,
                    bomCode: 'ZMKW3744',
                    categoryId: micro.id,
                    modelCode: 'LEGACY-KW',
                    spec: { 底座: '二脚底座（无挡脚）' },
                    specHash: Buffer.from('a'.repeat(64), 'hex'),
                    requestKey: 'e2e-legacy-kw',
                    createdBy: superUser.id,
                    updatedBy: superUser.id,
                    createdAt: now,
                },
                {
                    id: 9000000000000002n,
                    bomCode: 'ZMKW16012',
                    categoryId: old.id,
                    modelCode: 'LEGACY-KW16',
                    spec: { 底座: '带CB' },
                    specHash: Buffer.from('b'.repeat(64), 'hex'),
                    requestKey: 'e2e-legacy-kw16',
                    createdBy: superUser.id,
                    updatedBy: superUser.id,
                    createdAt: now,
                },
            ],
        });

        // 新微动续接品类内 MAX(3744) → ZMKW3745；若 JOIN 品类过滤丢失，
        // ZMKW16012 会被 KW 前缀误读为 16012 → 取 ZMKW16013 撞老微动序列
        const microNext = await createBom(
            {
                name: '新微动',
                modelCode: `${RUN}-boot`,
                specs: {
                    底座: '三脚底座（有挡脚）',
                    按钮高度: '8.5mm',
                    支架: '6.3支架：铜镀银',
                    静片: '6.3静片：铜镀银',
                    动片: '铜镀银',
                    摆片: '铁镀镍摆片',
                    弹片: '0.12',
                },
            },
            `e2e-bom-${RUN}-boot-micro`,
        );
        expect(microNext.statusCode).toBe(200);
        expect(microNext.json().data.code).toBe('ZMKW3745');

        const oldNext = await createBom(
            { name: '老微动', modelCode: `${RUN}-boot`, specs: { 底座: '带CB', 按钮: '8.9mm' } },
            `e2e-bom-${RUN}-boot-old`,
        );
        expect(oldNext.statusCode).toBe(200);
        expect(oldNext.json().data.code).toBe('ZMKW16013');
    });

    it('staff 无 bom:create 403', async () => {
        const staffToken = await createUser(accountOf('staff02'), 'staff');
        const denied = await createBom(
            { name: '旋转开关', modelCode: `${RUN}-staff`, specs: { 脚位: '二脚' } },
            `e2e-bom-${RUN}-staff`,
            staffToken,
        );
        expect(denied.statusCode).toBe(403);
        expect(denied.json().message).toBe('无权新建 BOM');
    });
});
