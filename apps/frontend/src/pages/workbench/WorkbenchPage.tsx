/* 工作台占位页：原快照聚合数据层（src/api/snapshot.ts）已移除，
   角色化工作台视图（待办 / 收发 / 趋势概览）将随数据层统一重构一并实现。 */
export function WorkbenchPage() {
    return (
        <div className="flex flex-col gap-5">
            <section className="rounded-panel border border-dashed border-line-strong bg-white/[.97] px-6 py-16 text-center shadow-card">
                <h2 className="text-17 font-semibold text-ink">工作台建设中</h2>
                <p className="mx-auto mt-2 max-w-105 text-13 leading-relaxed text-muted">
                    按角色定制的待办、收发与趋势概览将在此统一提供。期间可从左侧菜单进入销售订单、成品出入库等页面处理业务。
                </p>
            </section>
        </div>
    );
}
