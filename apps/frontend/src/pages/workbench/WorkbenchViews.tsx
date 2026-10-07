import { NavLink } from "react-router";
import { Icon } from "@/lib/icons";

export function WorkbenchViews({ active }: { active: "overview" | "delivery" }) {
    const tabClass = (selected: boolean) =>
        `inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-13 font-medium transition-colors ${
            selected ? "bg-surface text-primary-strong shadow-sm" : "text-muted hover:text-ink"
        }`;

    return (
        <nav
            aria-label="工作台视图"
            className="flex w-fit max-w-full items-center gap-1 rounded-btn border border-line bg-soft p-1"
        >
            <NavLink to="/workbench" end className={tabClass(active === "overview")}>
                <Icon name="grid" size={16} />
                经营总览
            </NavLink>
            <NavLink to="/workbench/delivery-gantt" className={tabClass(active === "delivery")}>
                <Icon name="chart" size={16} />
                交付甘特图
            </NavLink>
        </nav>
    );
}
