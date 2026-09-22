/* 6 个布局模式示意图（104×66），从 vben effects/layouts/.../preferences/icons/*.vue 逐元素移植：
   - hsl(var(--primary)) → var(--color-primary)（跟随内置主题/暗色）
   - currentColor + fillOpacity 的占位块自适应明暗
   - 中性灰/白为 vben 原字面量，两种主题下均成立 */

type IconProps = { className?: string };

function SvgFrame({ className, children }: IconProps & { children: React.ReactNode }) {
    return (
        <svg
            viewBox="0 0 104 66"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
            aria-hidden="true"
        >
            {children}
        </svg>
    );
}

/* 垂直：主色整列侧栏（logo + 菜单条），右侧内容区小顶栏 */
export function SidebarNavIcon({ className }: IconProps) {
    return (
        <SvgFrame className={className}>
            <rect width="104" height="66" rx="4" fill="currentColor" fillOpacity="0.02" />
            <path
                d="m-3.37838,3.61916a4.4919,4.02457 0 0 1 4.4919,-4.02457l26.35848,0l0,66.40541l-26.35848,0a4.4919,4.02457 0 0 1 -4.4919,-4.02457l0,-58.35627z"
                fill="var(--color-primary)"
            />
            <rect x="4.906" y="23.884" width="17.66" height="2.789" rx="1.395" fill="#e5e5e5" />
            <rect x="8.83" y="5.881" width="9.811" height="9.706" rx="2" fill="#ffffff" />
            <path
                d="m4.906,35.833c0,-0.75801 0.63699,-1.395 1.395,-1.395l14.87,0c0.75801,0 1.395,0.63699 1.395,1.395l0,-0.001c0,0.75801 -0.63699,1.395 -1.395,1.395l-14.87,0c-0.75801,0 -1.395,-0.63699 -1.395,-1.395l0,0.001z"
                fill="#ffffff"
            />
            <rect x="4.906" y="44.992" width="17.66" height="2.789" rx="1.395" fill="#ffffff" />
            <rect x="4.906" y="55.546" width="17.66" height="2.789" rx="1.395" fill="#ffffff" />
            <rect x="28.98" y="1.43" width="73.539" height="9.07" rx="2" fill="currentColor" fillOpacity="0.08" />
            <rect x="32.039" y="3.899" width="3.925" height="4.4" rx="1" fill="#b2b2b2" />
            <rect x="80.751" y="3.629" width="3.925" height="4.4" rx="1" fill="#b2b2b2" />
            <rect x="87.582" y="3.494" width="3.925" height="4.4" rx="1" fill="#b2b2b2" />
            <rect x="94.685" y="3.629" width="3.925" height="4.4" rx="1" fill="#b2b2b2" />
            <rect x="56.052" y="14.613" width="45.631" height="21.519" rx="2" fill="currentColor" fillOpacity="0.08" />
            <rect x="29.385" y="14.613" width="22.83" height="20.978" rx="2" fill="currentColor" fillOpacity="0.08" />
            <rect x="28.98" y="39.482" width="72.458" height="21.654" rx="2" fill="currentColor" fillOpacity="0.08" />
        </SvgFrame>
    );
}

/* 双列菜单：细主色轨（logo + 短条）+ 浅色子栏，右侧内容区小顶栏 */
export function SidebarMixedNavIcon({ className }: IconProps) {
    return (
        <SvgFrame className={className}>
            <rect x="0.135" y="0.135" width="104" height="66" rx="4" fill="currentColor" fillOpacity="0.02" />
            <path
                d="m-3.37838,3.7543a1.93401,4.02457 0 0 1 1.93401,-4.02457l11.3488,0l0,66.40541l-11.3488,0a1.93401,4.02457 0 0 1 -1.93401,-4.02457l0,-58.35627z"
                fill="var(--color-primary)"
            />
            <rect x="1.641" y="15.461" width="5.474" height="2.789" rx="1.395" fill="#e5e5e5" />
            <rect x="0.587" y="1.422" width="8.189" height="7.679" rx="2" fill="#ffffff" />
            <rect x="25.383" y="1.429" width="75.92" height="9.07" rx="2" fill="currentColor" fillOpacity="0.08" />
            <rect x="27.915" y="3.693" width="3.925" height="4.4" rx="1" fill="#b2b2b2" />
            <rect x="80.751" y="3.629" width="3.925" height="4.4" rx="1" fill="#b2b2b2" />
            <rect x="87.789" y="3.7" width="3.925" height="4.4" rx="1" fill="#b2b2b2" />
            <rect x="94.685" y="3.629" width="3.925" height="4.4" rx="1" fill="#b2b2b2" />
            <rect x="58.754" y="14.613" width="42.929" height="21.519" rx="2" fill="currentColor" fillOpacity="0.08" />
            <rect x="26.143" y="14.613" width="28.369" height="20.978" rx="2" fill="currentColor" fillOpacity="0.08" />
            <rect x="26.343" y="39.688" width="75.095" height="21.654" rx="2" fill="currentColor" fillOpacity="0.08" />
            <rect x="1.798" y="28.395" width="5.474" height="2.789" rx="1.395" fill="#e5e5e5" />
            <rect x="1.641" y="41.802" width="5.474" height="2.789" rx="1.395" fill="#e5e5e5" />
            <rect x="1.641" y="55.366" width="5.474" height="2.789" rx="1.395" fill="#e5e5e5" />
            <rect x="9.855" y="-0.026" width="12.493" height="65.721" fill="currentColor" fillOpacity="0.08" />
        </SvgFrame>
    );
}

/* 水平：通栏主色顶栏（logo + 横排菜单 + 头像），无侧栏 */
export function HeaderNavIcon({ className }: IconProps) {
    return (
        <SvgFrame className={className}>
            <rect x="0.135" y="0.135" width="104" height="66" rx="4" fill="currentColor" fillOpacity="0.02" />
            <rect x="-0.074" y="-0.058" width="104.079" height="9.07" fill="var(--color-primary)" />
            <rect x="15.582" y="3.208" width="7.525" height="2.789" rx="1.395" fill="#e5e5e5" />
            <path
                d="m98.19822,2.872c0,-0.54338 0.45662,-1 1,-1l1.925,0c0.54338,0 1,0.45662 1,1l0,2.4c0,0.54338 -0.45662,1 -1,1l-1.925,0c-0.54338,0 -1,-0.45662 -1,-1l0,-2.4z"
                fill="#ffffff"
            />
            <rect x="43.484" y="13.667" width="53.604" height="21.519" rx="2" fill="currentColor" fillOpacity="0.08" />
            <path
                d="m3.43932,15.53192c0,-1.08676 1.03344,-2 2.26323,-2l30.33036,0c1.22979,0 2.26323,0.91324 2.26323,2l0,17.24865c0,1.08676 -1.03344,2 -2.26323,2l-30.33036,0c-1.22979,0 -2.26323,-0.91324 -2.26323,-2l0,-17.24865z"
                fill="currentColor"
                fillOpacity="0.08"
            />
            <rect x="3.304" y="39.347" width="95.025" height="21.654" rx="2" fill="currentColor" fillOpacity="0.08" />
            <rect x="28.149" y="3.073" width="7.525" height="2.789" rx="1.395" fill="#e5e5e5" />
            <rect x="41.257" y="3.208" width="7.525" height="2.789" rx="1.395" fill="#e5e5e5" />
            <rect x="54.23" y="3.073" width="7.525" height="2.789" rx="1.395" fill="#e5e5e5" />
            <rect x="1.533" y="0.881" width="7.784" height="7.138" rx="2" fill="#ffffff" />
        </SvgFrame>
    );
}

/* 侧边导航：通栏浅顶栏（logo + 面包屑），顶栏下方主色侧栏 */
export function HeaderSidebarNavIcon({ className }: IconProps) {
    return (
        <SvgFrame className={className}>
            <rect x="0.135" y="0.135" width="104" height="66" rx="4" fill="currentColor" fillOpacity="0.02" />
            <rect x="-0.074" y="-0.058" width="104.079" height="9.07" fill="currentColor" fillOpacity="0.08" />
            <rect x="10.082" y="3.508" width="6.525" height="1.689" rx="1.395" fill="#b2b2b2" />
            <rect x="80.751" y="2.894" width="3.925" height="4.4" rx="1" fill="#b2b2b2" />
            <rect x="87.582" y="2.894" width="3.925" height="4.4" rx="1" fill="#b2b2b2" />
            <path
                d="m98.19822,2.872c0,-0.54338 0.45662,-1 1,-1l1.925,0c0.54338,0 1,0.45662 1,1l0,2.4c0,0.54338 -0.45662,1 -1,1l-1.925,0c-0.54338,0 -1,-0.45662 -1,-1l0,-2.4z"
                fill="#ffffff"
            />
            <rect x="53.379" y="13.457" width="44.131" height="21.519" rx="2" fill="currentColor" fillOpacity="0.08" />
            <path
                d="m19.4393,15.74245c0,-1.08676 0.79001,-2 1.73013,-2l23.18605,0c0.94011,0 1.73013,0.91324 1.73013,2l0,17.24865c0,1.08676 -0.79001,2 -1.73013,2l-23.18605,0c-0.94011,0 -1.73013,-0.91324 -1.73013,-2l0,-17.24865z"
                fill="currentColor"
                fillOpacity="0.08"
            />
            <rect x="19.936" y="39.347" width="78.394" height="21.654" rx="2" fill="currentColor" fillOpacity="0.08" />
            <rect x="28.149" y="3.073" width="7.525" height="2.789" rx="1.395" fill="#e5e5e5" />
            <rect x="41.257" y="3.208" width="7.525" height="2.789" rx="1.395" fill="#e5e5e5" />
            <rect x="54.23" y="3.073" width="7.525" height="2.789" rx="1.395" fill="#e5e5e5" />
            <rect x="1.533" y="1.081" width="5.784" height="5.138" rx="2" fill="#ffffff" />
            <rect x="-0.064" y="9.031" width="15.446" height="56.812" fill="var(--color-primary)" />
            <path
                d="m2.38669,15.38074c0,-0.20384 0.27195,-0.37513 0.59557,-0.37513l7.98149,0c0.32362,0 0.59557,0.17129 0.59557,0.37513l0,3.23525c0,0.20384 -0.27195,0.37513 -0.59557,0.37513l-7.98149,0c-0.32362,0 -0.59557,-0.17129 -0.59557,-0.37513l0,-3.23525z"
                fill="#ffffff"
            />
            <path
                d="m2.38669,28.43336c0,-0.20384 0.27195,-0.37513 0.59557,-0.37513l7.98149,0c0.32362,0 0.59557,0.17129 0.59557,0.37513l0,3.23525c0,0.20384 -0.27195,0.37513 -0.59557,0.37513l-7.98149,0c-0.32362,0 -0.59557,-0.17129 -0.59557,-0.37513l0,-3.23525z"
                fill="#ffffff"
            />
            <path
                d="m2.17616,41.27545c0,-0.20384 0.27195,-0.37513 0.59557,-0.37513l7.98149,0c0.32362,0 0.59557,0.17129 0.59557,0.37513l0,3.23525c0,0.20384 -0.27195,0.37513 -0.59557,0.37513l-7.98149,0c-0.32362,0 -0.59557,-0.17129 -0.59557,-0.37513l0,-3.23525z"
                fill="#ffffff"
            />
            <path
                d="m2.17616,54.32806c0,-0.20384 0.27195,-0.37513 0.59557,-0.37513l7.98149,0c0.32362,0 0.59557,0.17129 0.59557,0.37513l0,3.23525c0,0.20384 -0.27195,0.37513 -0.59557,0.37513l-7.98149,0c-0.32362,0 -0.59557,-0.17129 -0.59557,-0.37513l0,-3.23525z"
                fill="#ffffff"
            />
        </SvgFrame>
    );
}

/* 混合垂直：通栏主色顶栏（横排菜单），下方浅色侧栏（当前组子项） */
export function MixedNavIcon({ className }: IconProps) {
    return (
        <SvgFrame className={className}>
            <rect x="0.135" y="0.135" width="104" height="66" rx="4" fill="currentColor" fillOpacity="0.02" />
            <rect x="-0.074" y="-0.058" width="104.079" height="9.07" fill="var(--color-primary)" />
            <rect x="15.582" y="3.208" width="7.525" height="2.789" rx="1.395" fill="#e5e5e5" />
            <path
                d="m98.19822,2.872c0,-0.54338 0.45662,-1 1,-1l1.925,0c0.54338,0 1,0.45662 1,1l0,2.4c0,0.54338 -0.45662,1 -1,1l-1.925,0c-0.54338,0 -1,-0.45662 -1,-1l0,-2.4z"
                fill="#ffffff"
            />
            <rect x="53.379" y="13.457" width="44.131" height="21.519" rx="2" fill="currentColor" fillOpacity="0.08" />
            <path
                d="m19.4393,15.74245c0,-1.08676 0.79001,-2 1.73013,-2l23.18605,0c0.94011,0 1.73013,0.91324 1.73013,2l0,17.24865c0,1.08676 -0.79001,2 -1.73013,2l-23.18605,0c-0.94011,0 -1.73013,-0.91324 -1.73013,-2l0,-17.24865z"
                fill="currentColor"
                fillOpacity="0.08"
            />
            <rect x="19.936" y="39.347" width="78.394" height="21.654" rx="2" fill="currentColor" fillOpacity="0.08" />
            <rect x="28.149" y="3.073" width="7.525" height="2.789" rx="1.395" fill="#e5e5e5" />
            <rect x="41.257" y="3.208" width="7.525" height="2.789" rx="1.395" fill="#e5e5e5" />
            <rect x="54.23" y="3.073" width="7.525" height="2.789" rx="1.395" fill="#e5e5e5" />
            <rect x="1.533" y="0.881" width="7.784" height="7.138" rx="2" fill="#ffffff" />
            <rect x="-0.064" y="9.031" width="15.446" height="56.812" fill="currentColor" fillOpacity="0.08" />
            <path
                d="m2.38669,15.38074c0,-0.20384 0.27195,-0.37513 0.59557,-0.37513l7.98149,0c0.32362,0 0.59557,0.17129 0.59557,0.37513l0,3.23525c0,0.20384 -0.27195,0.37513 -0.59557,0.37513l-7.98149,0c-0.32362,0 -0.59557,-0.17129 -0.59557,-0.37513l0,-3.23525z"
                fill="currentColor"
                fillOpacity="0.08"
            />
            <path
                d="m2.38669,28.43336c0,-0.20384 0.27195,-0.37513 0.59557,-0.37513l7.98149,0c0.32362,0 0.59557,0.17129 0.59557,0.37513l0,3.23525c0,0.20384 -0.27195,0.37513 -0.59557,0.37513l-7.98149,0c-0.32362,0 -0.59557,-0.17129 -0.59557,-0.37513l0,-3.23525z"
                fill="currentColor"
                fillOpacity="0.08"
            />
            <path
                d="m2.17616,41.27545c0,-0.20384 0.27195,-0.37513 0.59557,-0.37513l7.98149,0c0.32362,0 0.59557,0.17129 0.59557,0.37513l0,3.23525c0,0.20384 -0.27195,0.37513 -0.59557,0.37513l-7.98149,0c-0.32362,0 -0.59557,-0.17129 -0.59557,-0.37513l0,-3.23525z"
                fill="currentColor"
                fillOpacity="0.08"
            />
            <path
                d="m2.17616,54.32806c0,-0.20384 0.27195,-0.37513 0.59557,-0.37513l7.98149,0c0.32362,0 0.59557,0.17129 0.59557,0.37513l0,3.23525c0,0.20384 -0.27195,0.37513 -0.59557,0.37513l-7.98149,0c-0.32362,0 -0.59557,-0.17129 -0.59557,-0.37513l0,-3.23525z"
                fill="currentColor"
                fillOpacity="0.08"
            />
        </SvgFrame>
    );
}

/* 混合双列：通栏主色顶栏（横排菜单）+ 细主色轨 + 浅色子栏 */
export function HeaderMixedNavIcon({ className }: IconProps) {
    return (
        <SvgFrame className={className}>
            <rect x="0.135" y="0.135" width="104" height="66" rx="4" fill="currentColor" fillOpacity="0.02" />
            <path
                d="m-3.37838,3.7543a1.93401,4.02457 0 0 1 1.93401,-4.02457l11.3488,0l0,66.40541l-11.3488,0a1.93401,4.02457 0 0 1 -1.93401,-4.02457l0,-58.35627z"
                fill="var(--color-primary)"
            />
            <rect x="1.641" y="15.461" width="5.474" height="2.789" rx="1.395" fill="#e5e5e5" />
            <rect x="0.587" y="1.422" width="8.189" height="7.679" rx="2" fill="#ffffff" />
            <rect x="25.383" y="1.429" width="75.92" height="9.07" rx="2" fill="var(--color-primary)" />
            <rect x="27.915" y="3.693" width="3.925" height="4.4" rx="1" fill="#b2b2b2" />
            <rect x="80.751" y="3.629" width="3.925" height="4.4" rx="1" fill="#b2b2b2" />
            <rect x="87.789" y="3.7" width="3.925" height="4.4" rx="1" fill="#b2b2b2" />
            <rect x="94.685" y="3.629" width="3.925" height="4.4" rx="1" fill="#b2b2b2" />
            <rect x="58.754" y="14.613" width="42.929" height="21.519" rx="2" fill="currentColor" fillOpacity="0.08" />
            <rect x="26.143" y="14.613" width="28.369" height="20.978" rx="2" fill="currentColor" fillOpacity="0.08" />
            <rect x="26.343" y="39.688" width="75.095" height="21.654" rx="2" fill="currentColor" fillOpacity="0.08" />
            <rect x="1.798" y="28.395" width="5.474" height="2.789" rx="1.395" fill="#e5e5e5" />
            <rect x="1.641" y="41.802" width="5.474" height="2.789" rx="1.395" fill="#e5e5e5" />
            <rect x="1.641" y="55.366" width="5.474" height="2.789" rx="1.395" fill="#e5e5e5" />
            <rect x="9.855" y="-0.026" width="12.493" height="65.721" fill="currentColor" fillOpacity="0.08" />
            <rect x="35.149" y="4.073" width="7.525" height="2.789" rx="1.395" fill="#e5e5e5" />
            <rect x="47.257" y="4.208" width="7.525" height="2.789" rx="1.395" fill="#e5e5e5" />
            <rect x="59.23" y="4.073" width="7.525" height="2.789" rx="1.395" fill="#e5e5e5" />
        </SvgFrame>
    );
}
