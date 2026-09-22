import { useState } from "react";
import { NoteDialog } from "@/components/ui/NoteDialog";

/* 说明型菜单项（note，无路由）的弹窗状态：SidebarMenu / MenuPanel / MenuRail / HeaderMenu 各自持有一份。
   单独成文件：混入组件文件会破坏 React Fast Refresh */

export interface MenuNote {
    title: string;
    description: string;
}

export function useMenuNote() {
    const [note, setNote] = useState<MenuNote | null>(null);
    const noteDialog = <NoteDialog note={note} onClose={() => setNote(null)} />;
    return { openNote: setNote, noteDialog };
}
