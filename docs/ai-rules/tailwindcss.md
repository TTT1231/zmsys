# Tailwindcss v4+ 工具类使用规则（间距/尺寸类）

1. 优先使用原生刻度类，任意值 [ ] 是最后手段
2. 换算公式：刻度值 = px值 ÷ 4
   例：3px → 3÷4=0.75 → 使用 py-0.75
   例：8px → 8÷4=2 → 使用 m-2
3. 刻度值必须是 0.25 的整数倍才可用原生类
   例：5px → 5÷4=1.25（是0.25倍数）→ 可用 m-1.25
   例：5.5px → 5.5÷4=1.375（不是0.25倍数）→ 必须用 [5.5px]
4. 特殊值（full、screen、fit、calc() 等）不受此限，直接使用对应类或任意值

## 主题令牌（src/index.css @theme）

1. 字号：数字类名 = 设计稿 px 值，`text-13` 即 13px、`text-12.5` 即 12.5px（11–17、20/22/24/30 及 .5 档已内置；不绑 line-height，保持继承 1.5）
2. 圆角：语义令牌 `rounded-btn`(10px)、`rounded-input`(9px)、`rounded-card`(14px)、`rounded-panel`(18px)；默认档位 `rounded-md`(6px)、`rounded-xl`(12px) 已按设计稿锁定 px
3. 颜色：优先 Tailwind 调色板（`indigo-500` 等）或主题语义色（`text-td-strong`、`bg-soft`、`bg-panel`、`bg-scrim`、`from-sidebar`），不写裸 hex
4. 阴影：语义令牌 `shadow-glow`（品牌光晕）等，见 @theme
5. 仍需任意值的场景：无对应令牌的一次性色值（如状态徽章的 #fedf89）、`backdrop-blur-[2px]`、`tracking-[0.08em]`、`clamp()/calc()/dvh` 等
