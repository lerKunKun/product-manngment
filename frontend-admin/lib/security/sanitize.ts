/**
 * HTML 净化：所有 dangerouslySetInnerHTML 必须先过这里。
 * - 默认禁止 <script>、<iframe>、<object>、<embed>、<svg>、内联事件 (onerror/onload/...)、javascript: URL
 * - 保留富文本常用标签（p/strong/a/img/h1-6/ul/ol/li/blockquote/pre/code/table/...）
 * - 链接强制 target=_blank rel=noopener noreferrer，防 tabnabbing
 *
 * 实现：dompurify 客户端运行；SSR 阶段直接返回原串（不会渲染）— 服务端不能调用 DOMParser。
 * 调用方：仅在 client component 里使用。
 */
import DOMPurify from "dompurify";

let configured = false;
function ensureConfig() {
  if (configured) return;
  configured = true;
  if (typeof window === "undefined") return;
  // 给所有 <a> 强制安全属性
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node instanceof HTMLAnchorElement) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
}

export function sanitizeHtml(dirty: string | null | undefined): string {
  if (!dirty) return "";
  if (typeof window === "undefined") return ""; // SSR 阶段直接清空，避免泄漏未净化 HTML
  ensureConfig();
  return DOMPurify.sanitize(dirty, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "iframe", "object", "embed", "svg", "math"],
    FORBID_ATTR: ["style", "srcset"],
  });
}
