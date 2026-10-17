import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useIsMobile } from "@/lib/useIsMobile";
import { useListSearch } from "@/context/useListView";
import { Icon } from "@/lib/icons";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

export function MobileListSearch() {
    const search = useListSearch();
    const hintId = useId();
    const isMobile = useIsMobile();
    const [openOwner, setOpenOwner] = useState<symbol | null>(null);
    const [draft, setDraft] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const open = isMobile && !!search && openOwner === search.owner;
    useEffect(() => {
        if (!isMobile) setOpenOwner(null);
    }, [isMobile]);
    const close = () => setOpenOwner(null);
    const submit = (event?: FormEvent) => {
        event?.preventDefault();
        if (!search) return;
        search.submit(draft.trim());
        close();
    };

    if (!isMobile) return null;
    return (
        <>
            <Button
                iconOnly
                aria-label={search ? `搜索${search.title}` : "当前页面不支持搜索"}
                disabled={!search}
                onClick={() => {
                    if (!search) return;
                    setDraft(search.keyword);
                    setOpenOwner(search.owner);
                }}
                className="relative text-primary-strong lg:hidden"
            >
                <Icon name="search" size={20} />
                {!!search?.keyword && (
                    <span aria-hidden="true" className="absolute top-2 right-2 size-1.5 rounded-full bg-primary" />
                )}
            </Button>
            <Modal
                open={open}
                onClose={close}
                title={`搜索${search?.title ?? ""}`}
                width={480}
                layout="search"
                initialFocusRef={inputRef}
                footer={
                    <>
                        <Button variant="secondary" onClick={close}>
                            取消
                        </Button>
                        <Button onClick={() => submit()}>确认</Button>
                    </>
                }
            >
                <form onSubmit={submit}>
                    <label className="grid gap-2 text-14 font-medium text-ink">
                        搜索内容
                        <input
                            ref={inputRef}
                            type="search"
                            enterKeyHint="search"
                            autoComplete="off"
                            value={draft}
                            onChange={event => setDraft(event.target.value)}
                            onKeyDown={event => {
                                if (event.key === "Enter") {
                                    event.preventDefault();
                                    if (!event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) submit();
                                }
                            }}
                            placeholder="请输入文字或编号"
                            aria-describedby={hintId}
                            className="min-h-12 w-full min-w-0 rounded-input border border-line-strong bg-surface px-3 text-16 font-normal text-ink placeholder:text-subtle"
                        />
                    </label>
                    <p id={hintId} className="mt-2 text-13 text-muted">
                        可输入{search?.placeholder}。
                    </p>
                </form>
            </Modal>
        </>
    );
}
