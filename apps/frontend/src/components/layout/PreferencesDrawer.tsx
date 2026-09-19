import { useEffect, useState } from "react";
import { Icon } from "@/lib/icons";
import { Modal } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
import {
    DEFAULT_PREFERENCES,
    FONT_MAX,
    FONT_MIN,
    usePreferences,
    type ThemeMode,
    type ThemePreset,
} from "@/context/usePreferences";

/* 偏好设置抽屉（vben 式）：主题模式 / 内置主题 / 字体大小 / 色弱 / 灰色。
   复用 Modal 的 detail 布局（右侧全高抽屉，自带焦点陷阱与 Esc 关闭） */

const THEME_MODES: Array<{ value: ThemeMode; label: string; icon: string }> = [
    { value: "light", label: "浅色", icon: "sun" },
    { value: "dark", label: "深色", icon: "moon" },
    { value: "auto", label: "跟随系统", icon: "monitor" },
];

/* 色板取各预设浅色模式的主色（与 index.css 的 [data-theme] 令牌一致） */
const THEME_PRESETS: Array<{ value: ThemePreset; label: string; color: string }> = [
    { value: "default", label: "默认", color: "#4f46e5" },
    { value: "green", label: "浅绿色", color: "hsl(161 90% 43%)" },
    { value: "deep-green", label: "深绿色", color: "hsl(181 84% 32%)" },
    { value: "orange", label: "橘黄色", color: "hsl(18 89% 40%)" },
];

/* 选中框：ring 画在 box-shadow 上，宽度变化不影响布局（vben 用 outline 同理） */
const optionBox = (active: boolean) =>
    `flex h-15 w-full items-center justify-center rounded-md transition-all ${
        active ? "ring-2 ring-primary" : "ring-1 ring-line hover:ring-primary/50"
    }`;

function Block({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="flex flex-col py-4">
            <h3 className="mb-3 text-13 font-semibold tracking-tight text-ink">{title}</h3>
            {children}
        </section>
    );
}

/* 字号步进器：草稿态容忍输入中途的空串/个位数，失焦或步进时再钳制 */
function FontSizeField() {
    const { preferences, setFontSize } = usePreferences();
    const [draft, setDraft] = useState(String(preferences.fontSize));

    // 外部重置偏好时同步回显
    useEffect(() => {
        setDraft(String(preferences.fontSize));
    }, [preferences.fontSize]);

    const commit = (raw: string) => {
        const parsed = Number.parseInt(raw, 10);
        setFontSize(Number.isFinite(parsed) ? parsed : preferences.fontSize);
        setDraft(
            String(Number.isFinite(parsed) ? Math.min(FONT_MAX, Math.max(FONT_MIN, parsed)) : preferences.fontSize),
        );
    };

    const step = (delta: number) => setFontSize(prev => prev + delta);

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
                <div className="flex h-9 w-full items-center rounded-input border border-line">
                    <button
                        type="button"
                        aria-label="减小字号"
                        disabled={preferences.fontSize <= FONT_MIN}
                        onClick={() => step(-1)}
                        className="flex h-full w-9 shrink-0 items-center justify-center text-muted transition hover:text-ink disabled:pointer-events-none disabled:opacity-35"
                    >
                        <Icon name="minus" size={14} />
                    </button>
                    <input
                        type="text"
                        inputMode="numeric"
                        value={draft}
                        aria-label="字体大小"
                        onChange={event => setDraft(event.target.value.trim())}
                        onBlur={() => commit(draft)}
                        onKeyDown={event => {
                            if (event.key === "Enter") {
                                event.preventDefault();
                                commit(draft);
                            }
                        }}
                        className="w-full min-w-0 bg-transparent text-center text-14 text-ink outline-none"
                    />
                    <button
                        type="button"
                        aria-label="增大字号"
                        disabled={preferences.fontSize >= FONT_MAX}
                        onClick={() => step(1)}
                        className="flex h-full w-9 shrink-0 items-center justify-center text-muted transition hover:text-ink disabled:pointer-events-none disabled:opacity-35"
                    >
                        <Icon name="plus" size={14} />
                    </button>
                </div>
                <span className="text-12 whitespace-nowrap text-muted">px</span>
            </div>
        </div>
    );
}

export function PreferencesDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { preferences, setThemeMode, setThemePreset, setColorWeakMode, setColorGrayMode, reset } = usePreferences();
    const modified = JSON.stringify(preferences) !== JSON.stringify(DEFAULT_PREFERENCES);

    return (
        <Modal
            open={open}
            onClose={onClose}
            title="偏好设置"
            subtitle="自定义偏好设置 & 实时预览"
            layout="detail"
            width={384}
            footer={
                <button
                    type="button"
                    disabled={!modified}
                    onClick={reset}
                    className="inline-flex min-h-10 w-full cursor-pointer items-center justify-center gap-1.5 rounded-btn border border-line text-13.5 text-muted transition hover:border-primary-border hover:text-primary-strong disabled:pointer-events-none disabled:opacity-40"
                >
                    <Icon name="reset" size={14} />
                    恢复默认
                </button>
            }
        >
            <Block title="主题">
                <div className="grid grid-cols-3 gap-2">
                    {THEME_MODES.map(mode => (
                        <button
                            key={mode.value}
                            type="button"
                            aria-pressed={preferences.themeMode === mode.value}
                            onClick={() => setThemeMode(mode.value)}
                            className="flex flex-col cursor-pointer"
                        >
                            <span className={optionBox(preferences.themeMode === mode.value)}>
                                <Icon name={mode.icon} size={20} className="text-ink" />
                            </span>
                            <span className="mt-2 text-center text-12 text-muted">{mode.label}</span>
                        </button>
                    ))}
                </div>
            </Block>

            <Block title="内置主题">
                <div className="grid grid-cols-4 gap-2">
                    {THEME_PRESETS.map(preset => (
                        <button
                            key={preset.value}
                            type="button"
                            aria-pressed={preferences.themePreset === preset.value}
                            onClick={() => setThemePreset(preset.value)}
                            className="flex flex-col cursor-pointer"
                        >
                            <span className={optionBox(preferences.themePreset === preset.value)}>
                                <span className="size-5 rounded-md" style={{ backgroundColor: preset.color }} />
                            </span>
                            <span className="mt-2 truncate text-center text-12 text-muted">{preset.label}</span>
                        </button>
                    ))}
                </div>
            </Block>

            <Block title="字体大小">
                <FontSizeField />
            </Block>

            <Block title="其它">
                <Switch checked={preferences.colorWeakMode} onCheckedChange={setColorWeakMode}>
                    色弱模式
                </Switch>
                <Switch checked={preferences.colorGrayMode} onCheckedChange={setColorGrayMode}>
                    灰色模式
                </Switch>
            </Block>
        </Modal>
    );
}
