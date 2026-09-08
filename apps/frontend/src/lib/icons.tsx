import type { SVGProps } from "react";

/* 24×24 stroke 图标集（沿用原型的线性图标风格 stroke-width 1.8） */
const PATHS: Record<string, string[]> = {
    brand: ["M4.5 4.5h15v15h-15z", "M8.5 9h7", "M8.5 13h5", "M8.5 17h3"],
    grid: ["M4 4h7v7H4z", "M13 4h7v7h-7z", "M4 13h7v7H4z", "M13 13h7v7h-7z"],
    order: ["M6 3.5h9.5L19 7v13.5H6z", "M9.5 9h5", "M9.5 12.5h5", "M9.5 16h3", "M14.7 15.2l1.6 1.6 2.8-2.9"],
    users: [
        "M9.5 11.5a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z",
        "M3.8 19.5c.5-3 2.9-4.8 5.7-4.8s5.2 1.8 5.7 4.8",
        "M15.5 5.6a3.1 3.1 0 0 1 0 5.9",
        "M17.3 14.9c1.6.7 2.7 2.2 3 4.6",
    ],
    layers: ["M12 3.5 20 8l-8 4.5L4 8z", "M4 12.2l8 4.5 8-4.5", "M4 16.4l8 4.5 8-4.5"],
    inbound: ["M12 3.5 20 8v8l-8 4.5L4 16V8z", "M12 12.5v6", "M9.4 16l2.6 2.5L14.6 16", "M4 8l8 4.5L20 8"],
    truck: [
        "M2.5 6h11.5v10H2.5z",
        "M14 9.5h4l3 3.2V16h-7",
        "M6.7 18.6a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8z",
        "M17.3 18.6a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8z",
    ],
    chart: ["M4 4.5h16v15H4z", "M8 15.5v-4", "M12 15.5V8.5", "M16 15.5v-6.2"],
    log: ["M6 3.5h12v17H6z", "M9.5 8h5", "M9.5 11.5h5", "M9.5 15h3"],
    shield: ["M12 3.5 19 6v6c0 4.6-3 7.6-7 9-4-1.4-7-4.4-7-9V6z", "M9.2 11.8l2 2 3.6-3.7"],
    calendar: ["M4.5 5.5h15v14h-15z", "M8 3.5v4", "M16 3.5v4", "M4.5 9.5h15"],
    alert: ["M12 4 21 19.5H3z", "M12 10v4", "M12 16.6v.4"],
    plus: ["M12 5v14", "M5 12h14"],
    search: ["M10.8 17.3a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z", "M15.5 15.5 20 20"],
    close: ["M6 6l12 12", "M18 6 6 18"],
    info: ["M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17z", "M12 11v5", "M12 7.6v.4"],
    check: ["M5 12.5l4.5 4.5L19 7.5"],
    menu: ["M4 6.5h16", "M4 12h16", "M4 17.5h16"],
    more: ["M5 12h.4", "M12 12h.4", "M19 12h.4"],
    "chevron-left": ["M14.5 6 9 12l5.5 6"],
    "chevron-right": ["M9.5 6 15 12l-5.5 6"],
    "chevron-down": ["M6 9.5l6 5.5 6-5.5"],
    copy: ["M9 9h11v11H9z", "M5 15H4V4h11v1"],
    download: ["M12 4v10.5", "M7.5 11 12 15.5 16.5 11", "M5 19.5h14"],
    refresh: ["M20 12a8 8 0 1 1-2.5-5.8", "M20 3.5V8h-4.5"],
    location: [
        "M12 21s6.5-5.7 6.5-11a6.5 6.5 0 1 0-13 0C5.5 15.3 12 21 12 21z",
        "M12 12.4a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8z",
    ],
    edit: ["M4 20h4.5L20 8.5a2.1 2.1 0 0 0-3-3L5.5 17z", "M14.5 7l3 3"],
    eye: [
        "M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z",
        "M12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6z",
    ],
    "arrow-down": ["M12 5v13", "M6.5 12.5 12 18l5.5-5.5"],
    "arrow-up-right": ["M7 17 17 7", "M9.5 7H17v7.5"],
    file: ["M6.5 3.5h7L18 8v12.5h-11.5z", "M13.5 3.5V8H18"],
    settings: [
        "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z",
        "M19.4 13.5l1.8 1-1.8 3.2-2-.6a7 7 0 0 1-1.7 1l-.3 2.1h-3.6l-.3-2.1a7 7 0 0 1-1.7-1l-2 .6-1.8-3.2 1.6-1.2a7 7 0 0 1 0-2l-1.6-1.2 1.8-3.2 2 .6a7 7 0 0 1 1.7-1l.3-2.1h3.6l.3 2.1a7 7 0 0 1 1.7 1l2-.6 1.8 3.2-1.8 1.2a7 7 0 0 1 0 2z",
    ],
    cube: ["M12 3.5 20 8v8l-8 4.5L4 16V8z", "M4 8l8 4.5L20 8", "M12 12.5v8"],
};

interface IconProps extends SVGProps<SVGSVGElement> {
    name: string;
    size?: number;
}

export function Icon({ name, size = 20, ...rest }: IconProps) {
    const paths = PATHS[name] || PATHS.info;
    return (
        <svg
            viewBox="0 0 24 24"
            width={size}
            height={size}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            {...rest}
        >
            {paths.map(d => (
                <path key={d} d={d} />
            ))}
        </svg>
    );
}
