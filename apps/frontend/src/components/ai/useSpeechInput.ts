import { useCallback, useEffect, useRef, useState } from "react";

interface Recognition {
    lang: string;
    interimResults: boolean;
    continuous: boolean;
    onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
    onerror: ((event: { error: string }) => void) | null;
    onend: (() => void) | null;
    start: () => void;
    abort: () => void;
}
type SpeechWindow = Window & {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
};

export function useSpeechInput(onText: (text: string) => void, onError: (text: string) => void) {
    const [recording, setRecording] = useState(false);
    const active = useRef<Recognition | null>(null);
    const Constructor = (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition;
    const stop = useCallback(() => {
        const recognition = active.current;
        active.current = null;
        recognition?.abort();
        setRecording(false);
    }, []);
    useEffect(
        () => () => {
            active.current?.abort();
        },
        [],
    );
    return {
        supported: Boolean(Constructor),
        recording,
        stop,
        start: () => {
            if (!Constructor) {
                onError("当前浏览器不支持语音输入，请使用文字输入");
                return;
            }
            if (active.current) {
                stop();
                return;
            }
            const recognition = new Constructor();
            recognition.lang = "zh-CN";
            recognition.interimResults = true;
            recognition.continuous = false;
            recognition.onresult = event => {
                if (active.current === recognition)
                    onText(
                        Array.from(event.results)
                            .map(result => result[0]?.transcript ?? "")
                            .join(""),
                    );
            };
            recognition.onerror = event => {
                if (active.current !== recognition) return;
                onError(
                    event.error === "not-allowed"
                        ? "麦克风权限未开启，请允许访问后重试"
                        : event.error === "no-speech"
                          ? "没有听到语音，请重试"
                          : "语音识别暂不可用，请使用文字输入",
                );
                active.current = null;
                setRecording(false);
            };
            recognition.onend = () => {
                if (active.current === recognition) {
                    active.current = null;
                    setRecording(false);
                }
            };
            active.current = recognition;
            try {
                recognition.start();
                setRecording(true);
            } catch {
                active.current = null;
                onError("无法启动语音输入，请使用文字输入");
            }
        },
    };
}
