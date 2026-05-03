"use client";

// TODO i18n: 文案待统一抽取到 lib/i18n/messages.ts
import { useEffect, useState } from "react";
import { productApi, type ExternalLink } from "@/lib/api/product";
import type { ApiError } from "@/lib/api/client";
import { Badge } from "@/components/ui/Badge";

const KIND_LABEL: Record<ExternalLink["kind"], string> = {
  AD: "广告贴",
  BENCHMARK: "对标页",
  MATERIAL: "产品素材",
};

function isHttpUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * 顶部外部链接 chips bar：
 * - 输入框（粘 URL 回车 add）
 * - 已有链接展示成 pill，每条 chip 显示 url + 删除 X
 * - URL 必须 http(s)://
 *
 * 注：现有 product_external_link 表只支持 add/delete（无 PUT），所以 chip 不支持就地编辑。
 */
export function ExternalLinksBar({ productId }: { productId: number }) {
  const [list, setList] = useState<ExternalLink[]>([]);
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<ExternalLink["kind"]>("AD");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setList(await productApi.linkList(productId));
    } catch (e) {
      setErr((e as ApiError).message);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  async function add(raw?: string) {
    const v = (raw ?? url).trim();
    setErr("");
    if (!v) return;
    if (!isHttpUrl(v)) {
      setErr("链接必须以 http:// 或 https:// 开头");
      return;
    }
    setBusy(true);
    try {
      await productApi.linkCreate(productId, { kind, url: v });
      setUrl("");
      load();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function del(id: number) {
    try {
      await productApi.linkDelete(id);
      load();
    } catch (e) {
      setErr((e as ApiError).message);
    }
  }

  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span>外部链接</span>
        <span className="text-[10px]">仅记录，不抓取</span>
      </div>

      {list.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {list.map((l) => (
            <li
              key={l.id}
              className="flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pl-2 pr-1 text-xs"
            >
              <Badge variant="info" className="rounded-full">
                {KIND_LABEL[l.kind]}
              </Badge>
              <a
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className="max-w-[260px] truncate text-primary underline-offset-2 hover:underline"
                title={l.url}
              >
                {l.url}
              </a>
              <button
                type="button"
                onClick={() => del(l.id)}
                aria-label={`删除链接 ${l.url}`}
                className="ml-1 grid h-4 w-4 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as ExternalLink["kind"])}
          className="rounded border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="AD">广告贴</option>
          <option value="BENCHMARK">对标页</option>
          <option value="MATERIAL">产品素材</option>
        </select>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="粘贴 https:// 链接，回车添加"
          className="flex-1 min-w-[240px] rounded border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => add()}
          className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          + 添加
        </button>
      </div>
      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
    </div>
  );
}
