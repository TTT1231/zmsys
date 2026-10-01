import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Badge";
import { TextArea } from "@/components/ui/Field";

/** 台账作废弹窗（入库/出库共用）：原因必填（至少 2 个字），顶部危险说明经 children 注入；
 *  footer 提交按钮经 form id 关联表单，pending 期间禁止关闭与重复提交 */
export function VoidReasonModal({
    title,
    subtitle,
    formId,
    pending,
    confirmLabel = "确认作废",
    placeholder,
    children,
    onClose,
    onConfirm,
}: {
    title: string;
    subtitle: string;
    /** 表单 id（footer 的提交按钮经 form 关联，弹窗内不渲染原生提交按钮） */
    formId: string;
    pending: boolean;
    confirmLabel?: string;
    placeholder: string;
    /** 原因输入框上方的说明区（DangerNote、跨天警示等） */
    children?: ReactNode;
    onClose: () => void;
    onConfirm: (reason: string) => void;
}) {
    const [reason, setReason] = useState("");
    const [error, setError] = useState("");
    const submit = (event: FormEvent) => {
        event.preventDefault();
        const value = reason.trim();
        if (value.length < 2) {
            setError("请填写作废原因（至少 2 个字）");
            return;
        }
        setError("");
        onConfirm(value);
    };
    const close = () => {
        if (!pending) onClose();
    };

    return (
        <Modal
            open
            onClose={close}
            title={title}
            subtitle={subtitle}
            width={480}
            footer={
                <>
                    <Button size="sm" variant="secondary" type="button" disabled={pending} onClick={close}>
                        取消
                    </Button>
                    <Button size="sm" variant="danger" type="submit" form={formId} disabled={pending}>
                        {pending ? "正在作废…" : confirmLabel}
                    </Button>
                </>
            }
        >
            <form id={formId} onSubmit={submit} aria-busy={pending}>
                {children}
                <TextArea
                    label="作废原因"
                    required
                    value={reason}
                    error={error}
                    placeholder={placeholder}
                    onChange={event => setReason(event.target.value)}
                />
            </form>
        </Modal>
    );
}
