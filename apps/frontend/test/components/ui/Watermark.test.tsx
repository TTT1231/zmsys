// @vitest-environment jsdom
/* GlobalWatermark:body 挂载全屏斜纹层、篡改样式/删除节点立即恢复、文本变化与卸载清理 */
import "@testing-library/jest-dom/vitest";

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GlobalWatermark } from "@/components/ui/Watermark";

// jsdom 无 canvas 实现:stub 2d 上下文,toDataURL 按最后绘制文本返回,便于断言水印内容
const ctx2d = {
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    textBaseline: "",
    measureText: (text: string) => ({
        width: text.length * 14,
        actualBoundingBoxAscent: 11,
        actualBoundingBoxDescent: 3,
    }),
    translate: vi.fn(),
    rotate: vi.fn(),
    strokeText: vi.fn(),
    fillText: vi.fn(),
};
const markNode = () => document.body.querySelector<HTMLElement>('div[aria-hidden="true"]');

describe("GlobalWatermark", () => {
    beforeEach(() => {
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
            ctx2d as unknown as CanvasRenderingContext2D,
        );
        vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(
            () => `data:image/png;base64,${ctx2d.fillText.mock.calls.at(-1)?.[0] ?? ""}`,
        );
    });
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        document.body.replaceChildren();
    });

    it("挂载全屏水印层:盖住所有弹层的 z-index、不挡交互、平铺背景含用户文本", () => {
        render(<GlobalWatermark text="郭军 · guojun" />);
        const mark = markNode();
        expect(mark).not.toBeNull();
        expect(mark?.style.zIndex).toBe("300");
        expect(mark?.style.pointerEvents).toBe("none");
        // jsdom 的 CSS 解析器会丢弃含非 ASCII 的 url(),故断言原始 style attribute
        expect(mark?.getAttribute("style")).toContain("郭军 · guojun");
    });

    it("篡改 style 或加 class 隐藏 → 立即恢复原样", async () => {
        render(<GlobalWatermark text="郭军 · guojun" />);
        const mark = markNode();
        mark!.style.display = "none";
        mark!.className = "hidden";
        await waitFor(() => {
            expect(markNode()?.className).toBe("");
            expect(markNode()?.style.display).toBe("block");
        });
    });

    it("F12 删除水印节点 → 自动重新挂回 body", async () => {
        render(<GlobalWatermark text="郭军 · guojun" />);
        markNode()!.remove();
        expect(markNode()).toBeNull();
        await waitFor(() => {
            expect(markNode()?.isConnected).toBe(true);
        });
    });

    it("文本变化(改名)→ 背景图更新为新身份", async () => {
        const { rerender } = render(<GlobalWatermark text="郭军 · guojun" />);
        rerender(<GlobalWatermark text="李销售 · li_xiaomei" />);
        await waitFor(() => {
            expect(markNode()?.getAttribute("style")).toContain("李销售 · li_xiaomei");
        });
    });

    it("卸载 → 水印节点移除且 observer 停止(不再自我恢复)", async () => {
        const { unmount } = render(<GlobalWatermark text="郭军 · guojun" />);
        unmount();
        expect(markNode()).toBeNull();
        // 卸载后人为触发 body 变化,确认 observer 已断开、节点不会被复活
        document.body.appendChild(document.createElement("div"));
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(markNode()).toBeNull();
    });
});
