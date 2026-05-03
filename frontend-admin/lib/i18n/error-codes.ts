/** 错误码 → 中文描述。镜像 backend-api ResultCode.java 的 message 字段。 */
export const ERROR_CODE_ZH: Record<number, string> = {
  0: "OK",

  // 4xx 客户端错误（10000~19999）
  10000: "请求参数错误",
  10001: "未登录或登录已过期",
  10002: "无权操作",
  10003: "资源不存在",
  10004: "资源冲突或重复",
  10005: "参数校验失败",

  // 业务错误（20000~29999）
  20000: "业务异常",
  20100: "邀请链接已过期",
  20101: "临时密码不正确",
  20102: "邀请已被接受",
  20103: "邀请已被撤销",
  20104: "账号有效期必须在 1~90 天之间",
  20105: "该邮箱已有待接受的邀请",
  20200: "用户名或密码错误",
  20201: "账号已冻结",
  20202: "账号已到期",
  20203: "登录失败次数过多，请稍后再试",

  // 5xx 服务端错误（50000~59999）
  50000: "服务器内部错误",
  50001: "下游依赖不可用",
};

/** 给前端 toast 用：返回 "[code] 描述 — 业务详情" 形式 */
export function formatErrorToast(code: number, message?: string): string {
  const desc = ERROR_CODE_ZH[code];
  if (!desc) return `[${code}] ${message || "请求失败"}`;
  // 后端 message 有时是 "未登录或登录已过期: <detail>" 格式，detail 部分仍展示
  if (!message || message === desc || message.startsWith(desc)) {
    const tail = message && message.startsWith(desc) ? message.slice(desc.length).replace(/^[:：\s]+/, "") : "";
    return tail ? `[${code}] ${desc} — ${tail}` : `[${code}] ${desc}`;
  }
  return `[${code}] ${desc} — ${message}`;
}
