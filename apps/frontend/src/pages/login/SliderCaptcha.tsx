import { type KeyboardEvent, type PointerEvent, useCallback, useEffect, useRef, useState } from "react";

import { Icon } from "@/lib/icons";

/* vben SliderCaptcha 的 React 移植：拖动手柄到最右端完成验证，绿色进度条跟随手柄半宽。
   提示文字的流光效果（SpineText）见 index.css 的 .login-captcha-text。
   手柄带 role=slider 键盘路径（→ / End 完成，← / Home 归零），无鼠标布局（jsdom）也能验证。 */
const HANDLE_REM = 2.75; // 手柄宽（rem）：图标 16 + 两侧余量，与 w-11 同基（rem 随字号偏好缩放）
const HANDLE_HALF_REM = HANDLE_REM / 2;

interface SliderCaptchaProps {
    passed: boolean;
    onPassedChange: (passed: boolean) => void;
}

export function SliderCaptcha({ passed, onPassedChange }: SliderCaptchaProps) {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const handleRef = useRef<HTMLDivElement>(null);
    const [dragX, setDragX] = useState(0);
    const [dragging, setDragging] = useState(false);
    /* 拖拽起点：按下时的指针位置与手柄位置，位移 = 两者之差 */
    const dragOriginRef = useRef({ pointerX: 0, handleLeft: 0 });

    const complete = useCallback(() => {
        setDragging(false);
        onPassedChange(true);
    }, [onPassedChange]);

    /* 外部把 passed 置回 false（登录失败重验）时，手柄与进度条回位 */
    const prevPassedRef = useRef(passed);
    useEffect(() => {
        if (prevPassedRef.current && !passed) {
            setDragX(0);
            setDragging(false);
        }
        prevPassedRef.current = passed;
    }, [passed]);

    const maxOffset = () => {
        const wrapper = wrapperRef.current;
        const handle = handleRef.current;
        if (!wrapper || !handle) return 0;
        return wrapper.offsetWidth - handle.offsetWidth - 6;
    };

    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (passed) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        dragOriginRef.current = { pointerX: event.clientX, handleLeft: dragX };
        setDragging(true);
    };

    const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
        if (!dragging || passed) return;
        const maxX = maxOffset();
        if (maxX <= 0) return;
        const moveX = dragOriginRef.current.handleLeft + event.clientX - dragOriginRef.current.pointerX;
        const clamped = Math.max(0, Math.min(moveX, maxX));
        setDragX(clamped);
        if (clamped >= maxX) complete();
    };

    /* 未到终点松手：回位；越过阈值在 move 中已即时通过 */
    const onPointerEnd = () => {
        if (!dragging || passed) return;
        setDragging(false);
        setDragX(0);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (passed) return;
        if (event.key === "ArrowRight" || event.key === "End") {
            event.preventDefault();
            complete();
        } else if (event.key === "ArrowLeft" || event.key === "Home") {
            event.preventDefault();
            setDragX(0);
        }
    };

    const handleLeft = passed ? `calc(100% - ${HANDLE_REM}rem)` : `${dragX}px`;
    /* 进度条 = 手柄位置 + 半个手柄宽（vben 同款）：px 段跟指针位移，rem 段随字号偏好缩放 */
    const barWidth = passed ? `calc(100% - ${HANDLE_HALF_REM}rem)` : `calc(${dragX}px + ${HANDLE_HALF_REM}rem)`;

    return (
        <div
            ref={wrapperRef}
            className="relative flex h-10 w-full items-center overflow-hidden rounded-md border border-line bg-soft text-center select-none"
        >
            {/* 绿色进度条：宽度跟随手柄 + 半个手柄宽（vben 同款），到手后差半个手柄宽铺满 */}
            <div
                aria-hidden="true"
                className={`absolute inset-y-0 left-0 bg-success ${dragging ? "" : "transition-[width] duration-300"}`}
                style={{ width: barWidth }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
                <span className="login-captcha-text text-12 leading-5" data-passing={passed ? "true" : "false"}>
                    {passed ? "验证通过" : "请按住滑块拖动"}
                </span>
            </div>
            <div
                ref={handleRef}
                role="slider"
                tabIndex={passed ? -1 : 0}
                aria-label="滑块验证"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={passed ? 100 : 0}
                aria-disabled={passed}
                className={`absolute inset-y-0 left-0 flex w-11 touch-none items-center justify-center bg-surface shadow-md dark:bg-line-strong ${
                    passed
                        ? "cursor-default transition-[left] duration-300"
                        : `cursor-move ${dragging ? "rounded-md" : "transition-[left] duration-300"}`
                }`}
                style={{ left: handleLeft }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerEnd}
                onPointerCancel={onPointerEnd}
                onKeyDown={onKeyDown}
            >
                <Icon name={passed ? "check" : "chevrons-right"} size={16} className="text-td/60" />
            </div>
        </div>
    );
}
