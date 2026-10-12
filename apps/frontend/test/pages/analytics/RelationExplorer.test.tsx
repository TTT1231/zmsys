// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RelationsData, RelationType } from "@/data/relations";
import { RELATION_TYPES } from "@/data/relations";
import { RelationExplorer } from "@/pages/analytics/RelationExplorer";
import { history } from "./relationFixtures";

const all = new Set(RELATION_TYPES.map(type => type.key));
function Harness({
    data,
    selection = null,
    enabled = all,
}: {
    data: RelationsData;
    selection?: string | null;
    enabled?: Set<RelationType>;
}) {
    const [selected, setSelected] = useState(selection);
    return <RelationExplorer source={data} enabled={enabled} selectedId={selected} onSelect={setSelected} />;
}
beforeEach(() =>
    vi.stubGlobal(
        "ResizeObserver",
        class {
            observe() {}
            disconnect() {}
        },
    ),
);
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

it("千节点呈现连通的全局图，打开单型号保留客户人员和全部本页依赖", () => {
    const data = history(30, 4, 8, 5);
    const { container } = render(<Harness data={data} />);
    expect(data.nodes.length).toBe(992);
    expect(container.querySelectorAll("[data-family-id]")).toHaveLength(30);
    expect(container.querySelectorAll("[data-node-id]")).toHaveLength(32);
    expect(container.querySelectorAll(".relation-tree-links path")).toHaveLength(60);
    fireEvent.click(screen.getByRole("button", { name: "展开 bom:12 业务树" }));
    expect(container.querySelectorAll("[data-node-id]")).toHaveLength(12);
    fireEvent.click(screen.getByRole("button", { name: /^销售订单 order:12:0/ }));
    expect(container.querySelectorAll("[data-node-id]")).toHaveLength(16);
    expect(container.querySelectorAll(".relation-tree-links path")).toHaveLength(30);
    fireEvent.click(screen.getByRole("button", { name: "全局关系" }));
    expect(container.querySelectorAll("[data-family-id]")).toHaveLength(30);
    expect(screen.getByRole("button", { name: "展开 bom:12 业务树" })).toBeInTheDocument();
});

it("单型号自动展树，分页能看完入库，不丢弃单据；单订单自动展开实际出库", () => {
    const { container } = render(<Harness data={history(1, 1, 11, 4)} />);
    expect(container.querySelectorAll('[data-node-id^="inbound:"]')).toHaveLength(6);
    expect(container.querySelectorAll('[data-node-id^="outbound:"]')).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "下一页入库" }));
    expect(container.querySelectorAll('[data-node-id^="inbound:"]')).toHaveLength(5);
    expect(screen.getByRole("button", { name: /^入库 inbound:0:10/ })).toBeInTheDocument();
});

it("搜索后面的出库能定位到正确型号、订单和单据所在页", async () => {
    const { container } = render(<Harness data={history(4, 8, 11, 9)} selection="outbound:2:7:8" />);
    await waitFor(() => expect(screen.getByRole("button", { name: /^出库 outbound:2:7:8/ })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^销售订单 order:2:7/ })).toBeInTheDocument();
    expect(container.querySelector('[data-node-id="bom:2"]')).toBeInTheDocument();
    expect(container.querySelector('[data-node-id="bom:0"]')).not.toBeInTheDocument();
});

it("共享客户可查看关联型号，隐藏父类型不会伪造入库到订单关系", async () => {
    const data = history(3, 2, 4, 2);
    const view = render(<Harness data={data} selection="customer:shared" />);
    await screen.findByRole("heading", { name: "全局依赖关系" });
    expect(view.container.querySelectorAll("[data-family-id]")).toHaveLength(3);
    view.unmount();
    const { container } = render(<Harness data={history(1, 2, 4, 2)} enabled={new Set(["inbound", "outbound"])} />);
    expect(container.querySelectorAll("[data-node-id]")).toHaveLength(8);
    expect(container.querySelectorAll(".relation-tree-links path")).toHaveLength(0);
});

it("业务树中的人员是带真实连线的节点，选中人员保留业务树并突出参与关系", () => {
    const data = history(1, 1, 2, 2);
    data.edges
        .filter(edge => edge.kind === "person")
        .forEach(edge => {
            edge.relation = edge.target.startsWith("bom:") ? "建档" : "经办";
        });
    const { container } = render(<Harness data={data} />);
    expect(container.querySelector('[data-node-id="person:1"]')).toBeInTheDocument();
    expect(container.querySelector('[data-node-id="customer:shared"]')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^人员 person:1/ }));
    expect(screen.getByRole("group", { name: "业务树画布" })).toBeInTheDocument();
    expect(container.querySelectorAll("path.is-person.is-selected")).toHaveLength(6);
    expect(container.querySelectorAll(".relation-edge-label")).toHaveLength(6);
    expect(screen.getByText("建档")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看全局关联" }));
    expect(screen.getByRole("group", { name: "全局依赖关系画布" })).toBeInTheDocument();
});

it("收起出库后，重复点击同一订单仍能展开", () => {
    const { container } = render(<Harness data={history(1, 1, 1, 4)} />);
    const order = screen.getByRole("button", { name: /^销售订单 order:0:0/ });
    fireEvent.click(order);
    fireEvent.click(screen.getByRole("button", { name: "收起出库" }));
    expect(container.querySelectorAll('[data-node-id^="outbound:"]')).toHaveLength(0);
    fireEvent.click(order);
    expect(container.querySelectorAll('[data-node-id^="outbound:"]')).toHaveLength(4);
});

it("全部依赖模式包含当前型号全部实体和真实关系，不受单据分页与订单展开限制", () => {
    const data = history(1, 4, 11, 5);
    const { container } = render(<Harness data={data} />);
    fireEvent.click(screen.getByRole("button", { name: "查看全部依赖" }));
    expect(container.querySelectorAll("[data-node-id]")).toHaveLength(data.nodes.length);
    expect(container.querySelectorAll(".relation-tree-links path")).toHaveLength(data.edges.length);
    expect(screen.queryByRole("button", { name: "下一页入库" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回清晰分支" }));
    expect(container.querySelectorAll("[data-node-id]")).toHaveLength(12);
});
