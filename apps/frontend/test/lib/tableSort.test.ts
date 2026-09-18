// nextSortState：新列从升序开始，同列在升/降序间切换
import { expect, it } from "vitest";
import { nextSortState, type SortState } from "@/lib/tableSort";

type Key = "a" | "b";
const state = (key: Key, dir: "asc" | "desc"): SortState<Key> => ({ key, dir });

it("点击未激活列从升序开始", () => {
    expect(nextSortState(state("a", "asc"), "b")).toEqual(state("b", "asc"));
    expect(nextSortState(state("a", "desc"), "b")).toEqual(state("b", "asc"));
});

it("点击同列在升降序间切换", () => {
    expect(nextSortState(state("a", "asc"), "a")).toEqual(state("a", "desc"));
    expect(nextSortState(state("a", "desc"), "a")).toEqual(state("a", "asc"));
});
