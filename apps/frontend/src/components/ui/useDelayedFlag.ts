import { useEffect, useRef, useState } from "react";

/** 防闪烁标志(仿 vben content-spinner 参数):value 持续 showDelay 后才输出 true,
 *  快速完成(如 <200ms 的请求)全程不显示;一旦显示至少保持 minShow 再消失 */
export function useDelayedFlag(
    value: boolean,
    { showDelay = 200, minShow = 500 }: { showDelay?: number; minShow?: number } = {},
): boolean {
    const [shown, setShown] = useState(false);
    const showTimer = useRef<number | undefined>(undefined);
    const hideTimer = useRef<number | undefined>(undefined);
    const shownAt = useRef(0);

    useEffect(() => {
        if (value) {
            window.clearTimeout(hideTimer.current);
            if (shown) return;
            showTimer.current = window.setTimeout(() => {
                shownAt.current = Date.now();
                setShown(true);
            }, showDelay);
        } else {
            window.clearTimeout(showTimer.current);
            if (!shown) return;
            const remain = Math.max(0, minShow - (Date.now() - shownAt.current));
            hideTimer.current = window.setTimeout(() => setShown(false), remain);
        }
    }, [value, shown, showDelay, minShow]);

    useEffect(
        () => () => {
            window.clearTimeout(showTimer.current);
            window.clearTimeout(hideTimer.current);
        },
        [],
    );

    return shown;
}
