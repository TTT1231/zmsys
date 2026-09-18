import { useEffect, useMemo } from "react";

/* 全屏用户水印(拍照泄露溯源):canvas 生成斜纹平铺图,盖在所有弹层之上且不挡交互;
   命令式挂载 + MutationObserver 守护,改样式/删节点都会立即恢复,杜绝 F12 摘除 */

const FONT = `500 14px ${["system-ui", "-apple-system", "Segoe UI", "PingFang SC", "Microsoft YaHei", "sans-serif"].join(", ")}`;
const COLOR = "rgba(15, 23, 42, 0.12)";
const ROTATE = (-22 * Math.PI) / 180;
const GAP_X = 110;
const GAP_Y = 96;

/** 把文本画成一张带旋转的平铺 tile:canvas 取旋转后的外接矩形,background-repeat 平铺即得均匀斜纹 */
function tileDataUrl(text: string): string | null {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.font = FONT;
    const metrics = ctx.measureText(text);
    // 无字形环境(如测试)缺少 actualBoundingBox*,按 14px 字号给保守行高
    const textHeight = (metrics.actualBoundingBoxAscent ?? 11) + (metrics.actualBoundingBoxDescent ?? 3);
    const tileWidth = Math.ceil(metrics.width + GAP_X);
    const tileHeight = Math.ceil(textHeight + GAP_Y);
    const cos = Math.abs(Math.cos(ROTATE));
    const sin = Math.abs(Math.sin(ROTATE));
    canvas.width = Math.ceil(tileWidth * cos + tileHeight * sin);
    canvas.height = Math.ceil(tileWidth * sin + tileHeight * cos);
    ctx.font = FONT; // 设置画布尺寸会重置上下文状态
    ctx.textBaseline = "middle";
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(ROTATE);
    // 白底上白描边融入背景无副作用,深色侧边栏上则隐约可读
    ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
    ctx.lineWidth = 2;
    ctx.strokeText(text, -metrics.width / 2, 0);
    ctx.fillStyle = COLOR;
    ctx.fillText(text, -metrics.width / 2, 0);
    return canvas.toDataURL();
}

export function GlobalWatermark({ text }: { text: string }) {
    const dataUrl = useMemo(() => tileDataUrl(text), [text]);

    // 水印节点不进 React 树(卸载逻辑不受外部摘除牵连),挂 body 尾部;被改属性/被删除时 observer 立即恢复
    useEffect(() => {
        if (!dataUrl) return;
        const style = `position:fixed;inset:0;z-index:300;display:block;pointer-events:none;background-repeat:repeat;background-image:url(${dataUrl})`;
        const mark = document.createElement("div");
        mark.setAttribute("aria-hidden", "true");
        // 幂等恢复:只在值偏离期望时写入,否则赋值本身会再触发 observer 造成死循环
        const restore = () => {
            if (mark.getAttribute("class") !== null) mark.removeAttribute("class");
            if (mark.getAttribute("style") !== style) mark.setAttribute("style", style);
        };
        restore();
        document.body.appendChild(mark);
        const markObserver = new MutationObserver(restore);
        markObserver.observe(mark, { attributes: true, attributeFilter: ["style", "class"] });
        const bodyObserver = new MutationObserver(() => {
            if (!mark.isConnected) document.body.appendChild(mark);
        });
        bodyObserver.observe(document.body, { childList: true });
        return () => {
            markObserver.disconnect();
            bodyObserver.disconnect();
            mark.remove();
        };
    }, [dataUrl]);

    return null;
}
