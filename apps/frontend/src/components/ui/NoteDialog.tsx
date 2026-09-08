import { Modal } from "./Modal";

/* 通用说明弹窗（侧边栏「变更记录」等说明型入口使用） */
export function NoteDialog({ note, onClose }: { note: { title: string; description: string } | null; onClose: () => void }) {
  return (
    <Modal open={!!note} onClose={onClose} title={note?.title || ""} width={460}
      footer={
        <>
          <button type="button" onClick={onClose} className="min-h-10 rounded-btn border border-line-strong bg-white px-4 text-[13px] font-medium text-ink hover:border-primary-border">
            返回工作台
          </button>
          <button type="button" onClick={onClose} className="min-h-10 rounded-btn bg-primary px-4 text-[13px] font-medium text-white hover:bg-primary-hover">
            知道了
          </button>
        </>
      }
    >
      <p className="text-[13px] leading-relaxed text-muted">{note?.description}</p>
    </Modal>
  );
}
