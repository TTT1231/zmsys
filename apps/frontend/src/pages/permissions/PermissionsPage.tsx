import { ListState, RecordCard } from "../../components/ui/MobileList";
import { Badge, Button } from "../../components/ui/Badge";
import { PageHeading } from "../../components/ui/PageHeading";
import { CustomerCell } from "../../components/ui/cells";
import { useWbSnapshot } from "../../data/queries";
import { store } from "../../data/store";
import { num } from "../../lib/format";

export function PermissionsPage() {
  const { isLoading } = useWbSnapshot();
  const users = store.users;
  const events = store.systemEvents;
  const roles = new Set(users.map((user) => user.role));

  return (
    <div className="flex flex-col gap-5">
      <PageHeading
        eyebrow="系统设置"
        title="用户与权限"
        description="按管理员、仓管、销售配置菜单、查看与修改权限；权限变化保留操作日志。"
        actions={
          <Button variant="secondary" icon="shield" disabled>
            权限配置（原型预览）
          </Button>
        }
      />

      <div className="grid grid-cols-3 gap-2.5">
        {[
          { label: "用户总数", value: users.length, unit: "人" },
          { label: "角色数量", value: roles.size, unit: "个" },
          {
            label: "待处理系统事件",
            value: events.filter((event) => event.open).length,
            unit: "条",
          },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="relative flex min-h-[74px] flex-col justify-center overflow-hidden rounded-card border border-line/70 bg-white/90 px-4 py-3 shadow-xs"
          >
            <span className="absolute top-0 bottom-0 left-0 w-[3px] bg-[#c7d2fe]" />
            <span className="text-[11.5px] text-muted">
              {kpi.label}{" "}
              <strong className="tnum ml-1 text-[20px] font-bold text-ink">
                {num(kpi.value)}
              </strong>
              <span className="ml-1 text-[11.5px] text-subtle">{kpi.unit}</span>
            </span>
          </div>
        ))}
      </div>

      <section className="overflow-hidden rounded-panel border border-line bg-white/[.97] shadow-card">
        <div className="border-b border-line bg-gradient-to-b from-white to-[#fcfcfd] px-5 py-4">
          <h2 className="text-[15px] font-semibold text-ink">用户列表</h2>
        </div>
        <div className="mobile-records">
          <ListState loading={isLoading} empty={!users.length}>
            {users.map((user) => (
              <RecordCard
                key={user.account}
                title={user.name}
                subtitle={user.account}
                badge={<Badge>{user.role}</Badge>}
              />
            ))}
          </ListState>
        </div>
        <div className="hidden overflow-x-auto lg:block">
          {isLoading ? (
            <div className="py-16 text-center text-[13px] text-subtle">
              加载中…
            </div>
          ) : (
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr className="bg-[#f8fafc] text-left text-[12px] text-muted">
                  <th className="px-5 py-2.5 font-semibold">用户</th>
                  <th className="px-3 py-2.5 font-semibold">角色</th>
                  <th className="px-3 py-2.5 font-semibold">账号</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr
                    key={user.account}
                    className="border-t border-line/70 transition hover:bg-row-hover"
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-soft text-[13px] font-semibold text-primary-strong">
                          {user.name.slice(0, 1)}
                        </span>
                        <CustomerCell name={user.name} />
                      </div>
                    </td>
                    <td className="px-3 py-3 text-[13px] text-td">
                      {user.role}
                    </td>
                    <td className="px-3 py-3 tnum text-[13px] text-muted">
                      {user.account}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-panel border border-line bg-white/[.97] shadow-card">
        <div className="border-b border-line bg-gradient-to-b from-white to-[#fcfcfd] px-5 py-4">
          <h2 className="text-[15px] font-semibold text-ink">系统事件</h2>
        </div>
        <div className="mobile-records">
          <ListState loading={isLoading} empty={!events.length}>
            {events.map((event) => (
              <RecordCard
                key={event.ref + event.item}
                title={event.item}
                subtitle={`${event.module} · ${event.ref}`}
                badge={
                  <Badge tone={event.open ? "pending" : "success"}>
                    {event.state}
                  </Badge>
                }
              >
                <p>
                  {event.level} · {event.found}
                </p>
              </RecordCard>
            ))}
          </ListState>
        </div>
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr className="bg-[#f8fafc] text-left text-[12px] text-muted">
                <th className="px-5 py-2.5 font-semibold">级别</th>
                <th className="px-3 py-2.5 font-semibold">模块</th>
                <th className="px-3 py-2.5 font-semibold">事项</th>
                <th className="px-3 py-2.5 font-semibold">对象</th>
                <th className="px-3 py-2.5 font-semibold">发现时间</th>
                <th className="px-5 py-2.5 font-semibold">状态</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr
                  key={event.ref + event.item}
                  className="border-t border-line/70 transition hover:bg-row-hover"
                >
                  <td className="px-5 py-3">
                    <Badge tone={event.levelTone}>{event.level}</Badge>
                  </td>
                  <td className="px-3 py-3 text-[13px] text-td">
                    {event.module}
                  </td>
                  <td className="px-3 py-3 text-[13px] text-td">
                    {event.item}
                  </td>
                  <td className="px-3 py-3 tnum text-[12.5px] font-medium text-[#475467]">
                    {event.ref}
                  </td>
                  <td className="px-3 py-3 tnum text-[13px] text-td">
                    {event.found}
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone={event.open ? "pending" : "progress"}>
                      {event.state}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
