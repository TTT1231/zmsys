import { useEffect, useMemo } from "react";

/* 全屏用户水印(拍照泄露溯源):canvas 生成斜纹平铺图,盖在所有弹层之上且不挡交互;
   命令式挂载 + MutationObserver 守护,改样式/删节点都会立即恢复,杜绝 F12 摘除。
   视觉取 vben 式:2×2 对角网格(单格 160×200、间距 20)极稀疏排布,灰色低透明,
   不再干扰阅读;grid 矩阵 [[1,0],[0,1]] 等效为一张大 tile 内画两个对角标记后平铺 */

const FONT = `500 15px ${["system-ui", "-apple-system", "Segoe UI", "PingFang SC", "Microsoft YaHei", "sans-serif"].join(", ")}`;
/* vben: gray 半透明；浅色白侧栏上比旧深色侧栏显眼，取 0.2 折中（仍可溯源） */
const COLOR = "rgba(128, 128, 128, 0.2)";
const ROTATE = (-30 * Math.PI) / 180;
const CELL_W = 160;
const CELL_H = 200;
const GAP = 20;

/** 画一张含两个对角标记的平铺 tile:canvas 取旋转后的外接矩形,background-repeat 平铺即得 vben 式稀疏斜纹 */
function tileDataUrl(text: string, subtle: boolean): string | null {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.font = FONT;
    const metrics = ctx.measureText(text);
    // 长名字放宽单元格,保证标记之间仍有呼吸空隙
    const cellW = Math.max(CELL_W, Math.ceil(metrics.width + GAP * 3));
    const tileWidth = cellW * 2 + GAP * 2;
    const tileHeight = CELL_H * 2 + GAP * 2;
    const cos = Math.abs(Math.cos(ROTATE));
    const sin = Math.abs(Math.sin(ROTATE));
    canvas.width = Math.ceil(tileWidth * cos + tileHeight * sin);
    canvas.height = Math.ceil(tileWidth * sin + tileHeight * cos);
    ctx.font = FONT; // 设置画布尺寸会重置上下文状态
    ctx.textBaseline = "middle";
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(ROTATE);
    ctx.fillStyle = subtle ? "rgba(128, 128, 128, 0.12)" : COLOR;
    // 对角双标记:平移到未旋转 tile 的 (0,0) 原点后,在两个单元格中心各画一次
    ctx.fillText(text, -tileWidth / 2 + cellW / 2 - metrics.width / 2, -tileHeight / 2 + CELL_H / 2);
    ctx.fillText(
        text,
        -tileWidth / 2 + cellW + GAP + cellW / 2 - metrics.width / 2,
        -tileHeight / 2 + CELL_H + GAP + CELL_H / 2,
    );
    return canvas.toDataURL();
}

export function GlobalWatermark({ text, subtle = false }: { text: string; subtle?: boolean }) {
    const dataUrl = useMemo(() => tileDataUrl(text, subtle), [text, subtle]);

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
