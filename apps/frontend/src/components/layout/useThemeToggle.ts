import { flushSync } from "react-dom";
import { usePreferences } from "@/context/usePreferences";

/* vben 式明暗切换：View Transitions API 在点击坐标处做 clip-path 圆形扩散
   （450ms ease-in，切暗色为旧视图收缩、切浅色为新视图展开，配合 index.css 的
   ::view-transition z 序规则）。不支持该 API 或用户开启“减少动态效果”时直接切换 */

interface ThemeTransitionLike {
    ready: Promise<void>;
    skipTransition: () => void;
}

export function useThemeToggle() {
    const { isDark, setThemeMode } = usePreferences();

    return (event: { clientX: number; clientY: number }) => {
        const next = isDark ? "light" : "dark";
        const doc = document as Document & {
            startViewTransition?: (callback: () => void) => ThemeTransitionLike;
        };
        const reduceMotion =
            typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (!doc.startViewTransition || reduceMotion) {
            setThemeMode(next);
            return;
        }

        const x = event.clientX;
        const y = event.clientY;
        const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
        const transition = doc.startViewTransition(() => {
            // flushSync 保证过渡截图前 DOM 与 React 树都已切到新主题
            flushSync(() => setThemeMode(next));
        });
        void transition.ready.then(() => {
            const clipPath = [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`];
            const toDark = next === "dark";
            const animate = document.documentElement.animate(
                { clipPath: toDark ? [...clipPath].reverse() : clipPath },
                {
                    duration: 450,
                    easing: "ease-in",
                    pseudoElement: toDark ? "::view-transition-old(root)" : "::view-transition-new(root)",
                },
            );
            animate.onfinish = () => transition.skipTransition();
        });
    };
}
