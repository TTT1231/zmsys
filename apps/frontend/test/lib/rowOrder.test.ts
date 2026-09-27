// 行拖拽手动排序的顺序计算：moveItem 单元移动，mergeReordered 只重排参与行、未参与行原位合流
import { expect, it } from "vitest";
import { mergeReordered, moveItem } from "@/lib/rowOrder";

it("moveItem 移动元素并保留其余相对序", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
});

it("moveItem 原地或越界不移动，返回新数组", () => {
    const list = ["a", "b"];
    expect(moveItem(list, 1, 1)).toEqual(["a", "b"]);
    expect(moveItem(list, 1, 1)).not.toBe(list);
    expect(moveItem(list, -1, 0)).toEqual(["a", "b"]);
});

it("mergeReordered 只重排参与行，未参与行保持原位合流", () => {
    expect(mergeReordered(["a", "b", "c", "d", "e"], ["b", "d"], ["d", "b"])).toEqual(["a", "d", "c", "b", "e"]);
});

it("mergeReordered 参与行覆盖全量时即新序", () => {
    expect(mergeReordered(["a", "b", "c"], ["a", "b", "c"], ["c", "a", "b"])).toEqual(["c", "a", "b"]);
});

it("mergeReordered 空参与集返回原序", () => {
    expect(mergeReordered(["a", "b"], [], [])).toEqual(["a", "b"]);
});
