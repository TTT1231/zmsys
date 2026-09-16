/**
 * BOM/成品档案集成测试（物料目录模式）：真实 HTTP 管线 + 真实测试库（*_test
 * 种子数据：3 品类物料目录由迁移播种，bom_table 为空）。物料 id 从目录按名
 * 解析；写操作可重复执行；运行前置：pnpm test:db:reset。
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

    /** 按品类/分组/物料名解析目录 id（种子固定，按名解析保持与迁移解耦） */
    const itemIdOf = async (categoryKey: string, groupName: string, itemName: string): Promise<string> => {
        const row = await prisma.materialItem.findFirst({
            where: { group: { name: groupName, category: { categoryKey } }, name: itemName },
            select: { id: true },
        });
        if (!row) {
            throw new Error(`目录缺失：${categoryKey}/${groupName}/${itemName}`);
        }
        return row.id.toString();
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

    it('staff 可看品类目录（bom:view 全角色默认授权）；3 品类分区/分组树与选择语义', async () => {
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
        expect(categories).toHaveLength(6);
        expect(categories.map((category: { key: string }) => category.key)).toEqual([
            'rotary-switch',
            'rotary-xk3',
            'new-micro-switch',
            'old-micro-switch',
            'safety-switch',
            'tipover-switch',
        ]);
        // seqWidth 为默认 3 时省略；新微动 4 位宽度下发
        expect(categories[0]).toMatchObject({ name: '旋转XK2', codePrefix: 'XK2' });
        expect(categories[0]).not.toHaveProperty('seqWidth');
        expect(categories[2]).toMatchObject({ codePrefix: 'KW', seqWidth: 4 });
        expect(categories[1]).toMatchObject({ name: '旋转XK3', codePrefix: 'XK3' });
        expect(categories[4]).toMatchObject({ name: '安全开关', codePrefix: 'AQ' });
        expect(categories[5]).toMatchObject({
            name: '跌倒开关',
            codePrefix: 'KD',
            childCategories: ['new-micro-switch', 'old-micro-switch'],
        });
        expect(categories[0]).not.toHaveProperty('childCategories');

        // 旋转XK2：无分区，9 个单选组（型号全集 + 规格 + 方向）
        const rotary = categories[0].groups as Array<{ kind: string; name: string; multi: boolean | null }>;
        expect(rotary.map(group => [group.kind, group.name, group.multi])).toEqual([
            ['group', '型号', false],
            ['group', '规格', false],
            ['group', '方向', false],
            ['group', '杆子点位厚度', false],
            ['group', 'A面', false],
            ['group', 'B面', false],
            ['group', '弹簧', false],
        ]);

        // 新微动：PA66塑料 / 五金件 两分区，组挂分区下且为单选
        const micro = categories[2].groups as Array<{
            id: string;
            kind: string;
            name: string;
            parentId: string | null;
            key: string | null;
            items: Array<{ name: string }>;
        }>;
        expect(micro.map(group => [group.kind, group.name, group.parentId])).toEqual([
            ['section', 'PA66塑料', null],
            ['group', '底座', micro[0]!.id],
            ['group', '盖子', micro[0]!.id],
            ['group', '按钮', micro[0]!.id],
            ['section', '五金件', null],
            ['group', '支架', micro[4]!.id],
            ['group', '静片', micro[4]!.id],
            ['group', '动片', micro[4]!.id],
            ['group', '摆片', micro[4]!.id],
            ['group', '弹片', micro[4]!.id],
            ['section', '触点', null],
            ['group', '触点大小', micro[10]!.id],
            ['group', '触点厚度', micro[10]!.id],
            ['group', '触点类别', micro[10]!.id],
        ]);
        expect(micro.find(group => group.name === '支架')).toMatchObject({ key: 'bracket', multi: false });
        // 旋转XK3：根分组与分区按 sort_order 混排（外壳/底座/杆子 → 五金件 → 触点）
        const xk3 = categories[1].groups as Array<{ kind: string; name: string; multi: boolean | null }>;
        expect(xk3.slice(0, 3).map(group => group.name)).toEqual(['PC塑料外壳', 'PC塑料底座', 'PA66塑料杆子']);
        expect(xk3.filter(group => group.kind === 'section').map(group => group.name)).toEqual(['五金件', '触点']);
        // 安全开关：短款/长款系列配件为多选组
        const safety = categories[4].groups as Array<{ kind: string; name: string; multi: boolean | null }>;
        expect(safety.find(group => group.name === '短款/31mm系列配件')).toMatchObject({
            kind: 'group',
            multi: true,
        });
        expect(safety.filter(group => group.kind === 'section').map(group => group.name)).toEqual([
            'PA66塑料',
            '五金件',
            '触点',
        ]);
        expect(micro.find(group => group.name === '底座')!.items.map(item => item.name)).toEqual([
            '二脚底座（无挡脚）',
            '三脚底座（有挡脚）',
        ]);
    });

    it('建档成功：编号品类内自增、明细冻结快照、modelCode 由 model 组派生；不选 A/B 面亦可建档', async () => {
        const before = await app.inject({ method: 'GET', url: '/api/boms', headers: authHeaders(superToken) });
        expect(before.statusCode).toBe(200);
        const rotaryBefore = (before.json().data as Array<{ code: string }>).filter(bom =>
            bom.code.startsWith('ZMXK2'),
        ).length;

        const [model, direction, faceA, spring] = await Promise.all([
            itemIdOf('rotary-switch', '型号', '1-1'),
            itemIdOf('rotary-switch', '方向', '正面'),
            itemIdOf('rotary-switch', 'A面', '三脚银点'),
            itemIdOf('rotary-switch', '弹簧', '0.5'),
        ]);
        // 输入顺序与目录顺序相反：验证摘要仍按目录（冻结 position）排序
        const res = await createBom(
            { name: '旋转XK2', materialItemIds: [spring, faceA, direction, model] },
            `e2e-bom-${RUN}-create`,
        );
        expect(res.statusCode).toBe(200);
        const created = res.json().data;
        expect(created.code).toBe(`ZMXK2${String(rotaryBefore + 1).padStart(3, '0')}`);
        expect(created).toMatchObject({ name: '旋转XK2', modelCode: '1-1', unit: '个' });
        expect(created.created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(created.items.map((item: { name: string }) => item.name)).toEqual(['1-1', '正面', '三脚银点', '0.5']);
        expect(created.spec).toBe('型号：1-1 · 方向：正面 · A面：三脚银点 · 弹簧：0.5');

        const stored = await prisma.bomItem.findMany({
            where: { bom: { bomCode: created.code } },
            orderBy: { position: 'asc' },
        });
        expect(stored.map(item => [item.groupName, item.name, item.position])).toEqual([
            ['型号', '1-1', 1],
            ['方向', '正面', 2],
            ['A面', '三脚银点', 3],
            ['弹簧', '0.5', 4],
        ]);

        // 客户不需要 A/B 面：不选照样建档，摘要不含 A/B
        const [model2, spring2] = await Promise.all([
            itemIdOf('rotary-switch', '型号', '2-1'),
            itemIdOf('rotary-switch', '弹簧', '0.55'),
        ]);
        const minimal = await createBom(
            { name: '旋转XK2', materialItemIds: [model2, spring2] },
            `e2e-bom-${RUN}-minimal`,
        );
        expect(minimal.statusCode).toBe(200);
        expect(minimal.json().data.spec).toBe('型号：2-1 · 弹簧：0.55');

        const list = await app.inject({ method: 'GET', url: '/api/boms', headers: authHeaders(superToken) });
        const codes = (list.json().data as Array<{ code: string }>).map(bom => bom.code);
        expect(codes).toContain(created.code);
    });

    it('缺幂等键 400；品类不存在 404；空集合/非法 id/未知物料/单选组超项 400', async () => {
        const noKey = await app.inject({
            method: 'POST',
            url: '/api/boms',
            headers: authHeaders(superToken),
            payload: { name: '旋转XK2', materialItemIds: ['3003'] },
        });
        expect(noKey.statusCode).toBe(400);

        const missing = await createBom({ name: 'XK3', materialItemIds: ['3003'] }, `e2e-bom-${RUN}-missing`);
        expect(missing.statusCode).toBe(404);
        expect(missing.json().message).toBe('品类不存在');

        const empty = await createBom({ name: '旋转XK2', materialItemIds: [] }, `e2e-bom-${RUN}-empty`);
        expect(empty.statusCode).toBe(400);
        expect(empty.json().message).toBe('请至少选择一项物料');

        const badFormat = await createBom({ name: '旋转XK2', materialItemIds: ['abc'] }, `e2e-bom-${RUN}-format`);
        expect(badFormat.statusCode).toBe(400);
        expect(badFormat.json().message).toBe('物料编号格式无效');

        const unknown = await createBom({ name: '旋转XK2', materialItemIds: ['999999'] }, `e2e-bom-${RUN}-unknown`);
        expect(unknown.statusCode).toBe(400);
        expect(unknown.json().message).toBe('物料不存在、已停用或不属于该品类');

        const [bracketA, bracketB] = await Promise.all([
            itemIdOf('new-micro-switch', '支架', '6.3支架：铜镀银'),
            itemIdOf('new-micro-switch', '支架', '6.3支架：铜镀镍'),
        ]);
        const singleGroup = await createBom(
            { name: '新微动', materialItemIds: [bracketA, bracketB] },
            `e2e-bom-${RUN}-single-group`,
        );
        expect(singleGroup.statusCode).toBe(400);
        expect(singleGroup.json().message).toBe('分组「支架」只能选择一项物料');
    });

    it('只停用分区（组与物料仍启用）：新建被拒且目录隐藏整支；恢复后可用', async () => {
        const section = await prisma.materialGroup.findFirstOrThrow({
            where: { category: { categoryKey: 'new-micro-switch' }, name: 'PA66塑料', kind: 'SECTION' },
        });
        await prisma.materialGroup.update({ where: { id: section.id }, data: { status: false } });

        const catalog = await app.inject({
            method: 'GET',
            url: '/api/bom-categories',
            headers: authHeaders(superToken),
        });
        const micro = (catalog.json().data as Array<{ groups: Array<{ name: string }> }>)[1]!;
        expect(micro.groups.map(group => group.name)).not.toContain('PA66塑料');
        expect(micro.groups.map(group => group.name)).not.toContain('底座');

        const base = await itemIdOf('new-micro-switch', '底座', '二脚底座（无挡脚）');
        const denied = await createBom({ name: '新微动', materialItemIds: [base] }, `e2e-bom-${RUN}-section-off`);
        expect(denied.statusCode).toBe(400);
        expect(denied.json().message).toBe('物料不存在、已停用或不属于该品类');

        await prisma.materialGroup.update({ where: { id: section.id }, data: { status: true } });
        const allowed = await createBom({ name: '新微动', materialItemIds: [base] }, `e2e-bom-${RUN}-section-on`);
        expect(allowed.statusCode).toBe(200);
    });

    it('同集合判重 409 返回已有编码（输入顺序无关）；幂等重放与同键异体 409', async () => {
        const [direction, spring] = await Promise.all([
            itemIdOf('rotary-switch', '方向', '反面'),
            itemIdOf('rotary-switch', '弹簧', '0.6'),
        ]);
        const first = await createBom(
            { name: '旋转XK2', materialItemIds: [direction, spring] },
            `e2e-bom-${RUN}-dup-first`,
        );
        expect(first.statusCode).toBe(200);

        // 换幂等键 + 相同集合（顺序打乱）→ 409
        const dup = await createBom(
            { name: '旋转XK2', materialItemIds: [spring, direction] },
            `e2e-bom-${RUN}-dup-conflict`,
        );
        expect(dup.statusCode).toBe(409);
        expect(dup.json().message).toBe(`BOM 已存在：${first.json().data.code}`);

        // 同键同体：重放首次响应
        const replay = await createBom(
            { name: '旋转XK2', materialItemIds: [direction, spring] },
            `e2e-bom-${RUN}-dup-first`,
        );
        expect(replay.statusCode).toBe(200);
        expect(replay.json().data).toEqual(first.json().data);

        // 同键不同体 → 409（幂等键已被其他请求使用）
        const faceB = await itemIdOf('rotary-switch', 'B面', '塑料盖板');
        const keyConflict = await createBom(
            { name: '旋转XK2', materialItemIds: [direction, spring, faceB] },
            `e2e-bom-${RUN}-dup-first`,
        );
        expect(keyConflict.statusCode).toBe(409);
        expect(keyConflict.json().message).toBe('幂等键已被其他请求使用');
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
        const [microBase, microBracket] = await Promise.all([
            itemIdOf('new-micro-switch', '底座', '三脚底座（有挡脚）'),
            itemIdOf('new-micro-switch', '支架', '6.3支架：铜镀银'),
        ]);
        const microNext = await createBom(
            { name: '新微动', materialItemIds: [microBase, microBracket] },
            `e2e-bom-${RUN}-boot-micro`,
        );
        expect(microNext.statusCode).toBe(200);
        expect(microNext.json().data.code).toBe('ZMKW3745');

        const [oldBase, oldButton] = await Promise.all([
            itemIdOf('old-micro-switch', '底座', '带CB'),
            itemIdOf('old-micro-switch', '按钮', '8.9mm'),
        ]);
        const oldNext = await createBom(
            { name: '老微动', materialItemIds: [oldBase, oldButton] },
            `e2e-bom-${RUN}-boot-old`,
        );
        expect(oldNext.statusCode).toBe(200);
        expect(oldNext.json().data.code).toBe('ZMKW16013');
    });

    it('目录排序调整后，已建 BOM 摘要与明细不变（展示只读建档快照）', async () => {
        const [direction, spring] = await Promise.all([
            itemIdOf('rotary-switch', '方向', '正面'),
            itemIdOf('rotary-switch', '弹簧', '0.5'),
        ]);
        const created = await createBom(
            { name: '旋转XK2', materialItemIds: [direction, spring] },
            `e2e-bom-${RUN}-freeze`,
        );
        expect(created.statusCode).toBe(200);
        const code = created.json().data.code as string;
        const specBefore = created.json().data.spec as string;

        // 目录重排：方向组挪到型号之前
        const directionGroup = await prisma.materialGroup.findFirstOrThrow({
            where: { category: { categoryKey: 'rotary-switch' }, name: '方向' },
        });
        await prisma.materialGroup.update({ where: { id: directionGroup.id }, data: { sortOrder: 0 } });

        const list = await app.inject({ method: 'GET', url: '/api/boms', headers: authHeaders(superToken) });
        const bom = (list.json().data as Array<{ code: string; spec: string }>).find(item => item.code === code);
        expect(bom!.spec).toBe(specBefore);
    });

    it('跌倒开关：品类子选合并目录——跌倒物料 + 微动物料统一勾选建档', async () => {
        const [cover, base, ball, rocker] = await Promise.all([
            itemIdOf('tipover-switch', '跌倒盖', '跌倒盖KW16 / 有CB字'),
            itemIdOf('tipover-switch', '跌倒底', '跌倒底'),
            itemIdOf('tipover-switch', '钢球', '18mm钢球'),
            itemIdOf('tipover-switch', '翘板', '翘板'),
        ]);
        const tipoverIds = [cover, base, ball, rocker];
        const microIds = await Promise.all([
            itemIdOf('new-micro-switch', '底座', '二脚底座（无挡脚）'),
            itemIdOf('new-micro-switch', '盖子', '盖子'),
            itemIdOf('new-micro-switch', '按钮', '8.5mm'),
            itemIdOf('new-micro-switch', '支架', '6.3支架：铜镀银'),
            itemIdOf('new-micro-switch', '静片', '6.3静片：铜镀银'),
        ]);

        // 未带 childCategory → 400
        const missing = await createBom(
            { name: '跌倒开关', materialItemIds: tipoverIds },
            `e2e-bom-${RUN}-tipover-missing`,
        );
        expect(missing.statusCode).toBe(400);
        expect(missing.json().message).toBe('请选择微动开关类型');

        // childCategory 不在允许列表 → 400
        const wrong = await createBom(
            { name: '跌倒开关', materialItemIds: tipoverIds, childCategory: 'rotary-switch' },
            `e2e-bom-${RUN}-tipover-wrong`,
        );
        expect(wrong.statusCode).toBe(400);
        expect(wrong.json().message).toBe('微动开关类型不在本品类允许范围内');

        // 合法建档：跌倒物料 + 新微动物料（childCategory = new-micro-switch）
        const created = await createBom(
            { name: '跌倒开关', materialItemIds: [...tipoverIds, ...microIds], childCategory: 'new-micro-switch' },
            `e2e-bom-${RUN}-tipover-ok`,
        );
        expect(created.statusCode).toBe(200);
        expect(created.json().data.code).toMatch(/^ZMKD\d{3,}$/);
        expect(created.json().data.items).toHaveLength(9);
        expect(created.json().data.spec).toContain('跌倒盖：跌倒盖KW16 / 有CB字');
        expect(created.json().data.spec).toContain('底座：二脚底座（无挡脚）');
        expect(created.json().data.spec).toContain('静片：6.3静片：铜镀银');

        // 不带 childCategory 的普通品类物料混入（旋转XK2 的型号）→ 400
        const rotaryModel = await itemIdOf('rotary-switch', '型号', '1-1');
        const foreign = await createBom(
            {
                name: '跌倒开关',
                materialItemIds: [...tipoverIds, rotaryModel],
                childCategory: 'new-micro-switch',
            },
            `e2e-bom-${RUN}-tipover-foreign`,
        );
        expect(foreign.statusCode).toBe(400);

        // 同物料集合 → 409
        const dup = await createBom(
            { name: '跌倒开关', materialItemIds: [...tipoverIds, ...microIds], childCategory: 'new-micro-switch' },
            `e2e-bom-${RUN}-tipover-dup`,
        );
        expect(dup.statusCode).toBe(409);
        expect(dup.json().message).toBe(`BOM 已存在：${created.json().data.code}`);

        // 换老微动子品类 + 老微动物料 → 不同档案
        const oldMicroIds = await Promise.all([
            itemIdOf('old-micro-switch', '底座', '带CB'),
            itemIdOf('old-micro-switch', '按钮', '8.9mm'),
        ]);
        const second = await createBom(
            {
                name: '跌倒开关',
                materialItemIds: [...tipoverIds, ...oldMicroIds],
                childCategory: 'old-micro-switch',
            },
            `e2e-bom-${RUN}-tipover-old`,
        );
        expect(second.statusCode).toBe(200);
        expect(second.json().data.code).not.toBe(created.json().data.code);
    });

    it('staff 无 bom:create 403', async () => {
        const staffToken = await createUser(accountOf('staff02'), 'staff');
        const direction = await itemIdOf('rotary-switch', '方向', '正面');
        const denied = await createBom(
            { name: '旋转XK2', materialItemIds: [direction] },
            `e2e-bom-${RUN}-staff`,
            staffToken,
        );
        expect(denied.statusCode).toBe(403);
        expect(denied.json().message).toBe('无权新建 BOM');
    });

    it('库存余量聚合：入库后按 bomCode 返回净量，无流水的 BOM 不出现；bom:view 可读', async () => {
        const [direction, spring] = await Promise.all([
            itemIdOf('rotary-switch', '方向', '反面'),
            itemIdOf('rotary-switch', '弹簧', '0.55'),
        ]);
        const created = await createBom(
            { name: '旋转XK2', materialItemIds: [direction, spring] },
            `e2e-bom-${RUN}-stock`,
        );
        expect(created.statusCode).toBe(200);
        const code = created.json().data.code as string;

        // 未入库：视图无行，不进余量映射
        const before = await app.inject({ method: 'GET', url: '/api/bom-stocks', headers: authHeaders(superToken) });
        expect(before.statusCode).toBe(200);
        expect(Object.keys(before.json().data as Record<string, number>)).not.toContain(code);

        const inbound = await app.inject({
            method: 'POST',
            url: '/api/inbound',
            headers: { ...authHeaders(superToken), 'idempotency-key': `e2e-bom-${RUN}-stock-in` },
            payload: { bomCode: code, qty: 120, date: '2026-09-14', remark: '库存余量聚合 e2e' },
        });
        expect(inbound.statusCode).toBe(200);

        const staffToken = await createUser(accountOf('staff03'), 'staff');
        const after = await app.inject({ method: 'GET', url: '/api/bom-stocks', headers: authHeaders(staffToken) });
        expect(after.statusCode).toBe(200);
        expect(after.json().data[code]).toBe(120);
    });
});
