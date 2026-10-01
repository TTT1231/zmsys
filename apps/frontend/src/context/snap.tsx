import type { ReactNode } from "react";
import type { Snapshot } from "@/api";
import { SnapContext } from "./useSnap";

/** 页面根部包一层即可让子组件经 useSnap 消费同一份聚合快照 */
export function SnapProvider({ snap, children }: { snap: Snapshot; children: ReactNode }) {
    return <SnapContext value={snap}>{children}</SnapContext>;
}
