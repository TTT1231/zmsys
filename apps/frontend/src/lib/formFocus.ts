/* 表单提交校验失败后聚焦弹窗内第一个报错输入（aria-invalid）：
 * rAF 等 React 渲染出错误态后再查询，键盘/读屏用户不丢语境 */
export const focusFirstInvalid = () => {
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[role="dialog"] [aria-invalid="true"]')?.focus());
};
