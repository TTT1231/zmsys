import { Button } from "./Button";
import { Modal } from "./Modal";

/* 通用说明弹窗（侧边栏「变更记录」等说明型入口使用） */
export function NoteDialog({
    note,
    onClose,
}: {
    note: { title: string; description: string } | null;
    onClose: () => void;
}) {
    return (
        <Modal
            open={!!note}
            onClose={onClose}
            title={note?.title || ""}
            width={460}
            footer={
                <>
                    <Button size="sm" variant="secondary" onClick={onClose}>
                        返回工作台
                    </Button>
                    <Button size="sm" onClick={onClose}>
                        知道了
                    </Button>
                </>
            }
        >
            <p className="text-14 leading-relaxed text-muted">{note?.description}</p>
        </Modal>
    );
}
