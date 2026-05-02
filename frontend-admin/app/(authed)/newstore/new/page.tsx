"use client";

/**
 * W3-NEW-10: 一键开店向导 (5 步)
 *
 * Step 1 基本信息：选 base_template (PUBLISHED) + 品牌名 + 自定义域名 + tenantId
 * Step 2 替换规则：从所选模板的 default_replace_rules 派生 key-value 编辑表
 * Step 3 店铺接入：oauth | mock 二选一
 * Step 4 选产品：productApi.list 多选
 * Step 5 确认 + 启动 saga
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  templateApi,
  type BaseTemplate,
  type BaseTemplateVersion,
} from "@/lib/api/template";
import { productApi, type Product } from "@/lib/api/product";
import { sagaApi } from "@/lib/api/saga";
import { useAuthStore } from "@/lib/auth/store";
import { useToast } from "@/components/ui/Toast";
import {
  ErrorBanner,
  LoadingBlock,
  EmptyState,
  Spinner,
} from "@/components/ui/StatusBlocks";

type StepIdx = 1 | 2 | 3 | 4 | 5;
type Mode = "oauth" | "mock";

const STEP_LABELS: Record<StepIdx, string> = {
  1: "基本信息",
  2: "替换规则",
  3: "店铺接入",
  4: "选产品",
  5: "确认启动",
};

export default function NewStoreWizardPage() {
  const router = useRouter();
  const toast = useToast();
  const userId = useAuthStore((s) => s.user?.userId);

  const [step, setStep] = useState<StepIdx>(1);

  // ==== Step 1 ====
  const [tenantId, setTenantId] = useState<number>(1);
  const [brandName, setBrandName] = useState("");
  const [customDomain, setCustomDomain] = useState("");
  const [templates, setTemplates] = useState<BaseTemplate[]>([]);
  const [tplLoading, setTplLoading] = useState(false);
  const [tplError, setTplError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [defaultVersion, setDefaultVersion] = useState<BaseTemplateVersion | null>(null);

  // ==== Step 2 ====
  const [rules, setRules] = useState<Array<{ key: string; value: string }>>([]);

  // ==== Step 3 ====
  const [mode, setMode] = useState<Mode>("oauth");
  const [shopDomainHint, setShopDomainHint] = useState("");
  const [mockShopDomain, setMockShopDomain] = useState("");
  const [mockAccessToken, setMockAccessToken] = useState("");

  // ==== Step 4 ====
  const [products, setProducts] = useState<Product[]>([]);
  const [pLoading, setPLoading] = useState(false);
  const [pError, setPError] = useState<string | null>(null);
  const [pPage, setPPage] = useState(1);
  const [pTotal, setPTotal] = useState(0);
  const [pKeyword, setPKeyword] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const pSize = 20;

  // ==== Step 5 ====
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // -- Step 1: load published templates
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setTplLoading(true);
      setTplError(null);
      try {
        const r = await templateApi.list(1, 100, { status: "PUBLISHED" });
        if (!cancelled) setTemplates(r.records);
      } catch (e) {
        if (!cancelled) setTplError((e as Error).message);
      } finally {
        if (!cancelled) setTplLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // -- when templateId changes: pull detail for default_replace_rules
  useEffect(() => {
    if (templateId == null) {
      setDefaultVersion(null);
      setRules([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const d = await templateApi.detail(templateId);
        if (cancelled) return;
        const tpl = d.template;
        const ver =
          d.versions.find((v) => v.id === tpl.defaultTemplateVersionId) ??
          d.versions.find((v) => v.status === "PUBLISHED") ??
          d.versions[0] ??
          null;
        setDefaultVersion(ver);
        if (ver?.defaultReplaceRulesJson) {
          try {
            const obj = JSON.parse(ver.defaultReplaceRulesJson) as Record<string, unknown>;
            setRules(
              Object.entries(obj).map(([k, v]) => ({
                key: k,
                value: typeof v === "string" ? v : JSON.stringify(v),
              }))
            );
          } catch {
            setRules([]);
          }
        } else {
          setRules([]);
        }
      } catch {
        // toast 已上报
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  // -- Step 4: load products on entry / page change
  useEffect(() => {
    if (step !== 4) return;
    let cancelled = false;
    (async () => {
      setPLoading(true);
      setPError(null);
      try {
        const r = await productApi.list(pPage, pSize, pKeyword, "active");
        if (!cancelled) {
          setProducts(r.records);
          setPTotal(r.total);
        }
      } catch (e) {
        if (!cancelled) setPError((e as Error).message);
      } finally {
        if (!cancelled) setPLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, pPage]);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === templateId) ?? null,
    [templates, templateId]
  );

  function canNext(): { ok: boolean; reason?: string } {
    if (step === 1) {
      if (!tenantId || tenantId < 1) return { ok: false, reason: "请选择有效分公司 ID" };
      if (!brandName.trim()) return { ok: false, reason: "请输入品牌名" };
      if (templateId == null) return { ok: false, reason: "请选择基础模板" };
      return { ok: true };
    }
    if (step === 3) {
      if (mode === "oauth") {
        const d = shopDomainHint.trim().toLowerCase();
        if (!d.endsWith(".myshopify.com"))
          return { ok: false, reason: "OAuth 模式需填写 *.myshopify.com 域名提示" };
      } else {
        if (!mockShopDomain.trim().endsWith(".myshopify.com"))
          return { ok: false, reason: "请填写 *.myshopify.com 域名" };
        if (!mockAccessToken.trim()) return { ok: false, reason: "请填写 access_token" };
      }
      return { ok: true };
    }
    if (step === 4) {
      if (selected.size === 0) return { ok: false, reason: "请至少勾选 1 个产品" };
      return { ok: true };
    }
    return { ok: true };
  }

  function next() {
    const c = canNext();
    if (!c.ok) {
      toast.warn(c.reason ?? "请完成当前步骤");
      return;
    }
    setStep((s) => (s < 5 ? ((s + 1) as StepIdx) : s));
  }

  function prev() {
    setStep((s) => (s > 1 ? ((s - 1) as StepIdx) : s));
  }

  function setRuleKV(idx: number, k: string, v: string) {
    setRules((arr) => arr.map((r, i) => (i === idx ? { key: k, value: v } : r)));
  }
  function addRule() {
    setRules((arr) => [...arr, { key: "", value: "" }]);
  }
  function removeRule(idx: number) {
    setRules((arr) => arr.filter((_, i) => i !== idx));
  }

  function toggleProduct(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleStart() {
    const replaceRules: Record<string, string> = {};
    for (const r of rules) {
      const k = r.key.trim();
      if (k) replaceRules[k] = r.value;
    }
    const productIds = Array.from(selected);
    setSubmitting(true);
    setSubmitError(null);
    try {
      const startReq = {
        tenantId,
        triggeredBy: userId,
        templateId: templateId ?? undefined,
        replaceRules: Object.keys(replaceRules).length > 0 ? replaceRules : undefined,
        productIds,
        shopDomainHint:
          mode === "oauth" ? shopDomainHint.trim().toLowerCase() : undefined,
      };
      const r = await sagaApi.start(startReq);

      if (mode === "mock") {
        try {
          await sagaApi.mockAuth(
            r.taskId,
            mockShopDomain.trim().toLowerCase(),
            mockAccessToken
          );
          toast.success("Saga 已启动并完成 Mock 授权");
        } catch (e) {
          toast.warn(`Saga 已启动，但 mock-auth 失败：${(e as Error).message}`);
        }
        router.push(`/newstore/${r.taskId}`);
        return;
      }

      // oauth mode
      if (r.oauthUrl) {
        toast.info("即将跳转到 Shopify 授权页…");
        window.location.href = r.oauthUrl;
        return;
      }
      // 后端没有返回 oauthUrl —— 仍把用户带到 progress 页观察
      toast.warn("未返回 oauthUrl，跳到进度页观察后端状态");
      router.push(`/newstore/${r.taskId}`);
    } catch (e) {
      setSubmitError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link
          href="/newstore"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← 返回列表
        </Link>
        <h1 className="text-2xl font-semibold">一键开店向导</h1>
      </div>

      {/* Stepper */}
      <ol className="flex flex-wrap items-center gap-1 text-xs">
        {([1, 2, 3, 4, 5] as StepIdx[]).map((i, idx) => {
          const active = step === i;
          const done = step > i;
          return (
            <li key={i} className="flex items-center gap-1">
              <button
                type="button"
                disabled={i > step}
                onClick={() => i < step && setStep(i)}
                className={
                  "rounded-full border px-3 py-1 transition-colors " +
                  (active
                    ? "border-primary bg-primary text-primary-foreground"
                    : done
                      ? "border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
                      : "border-zinc-300 text-zinc-500")
                }
              >
                {i}. {STEP_LABELS[i]}
              </button>
              {idx < 4 && <span className="text-zinc-300">→</span>}
            </li>
          );
        })}
      </ol>

      {/* Step 1 */}
      {step === 1 && (
        <section className="space-y-4 rounded-lg border bg-background p-5">
          <h2 className="text-lg font-medium">Step 1 · 基本信息</h2>
          <Field label="所属分公司 ID">
            <input
              type="number"
              value={tenantId}
              onChange={(e) => setTenantId(Number(e.target.value) || 0)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="品牌名">
            <input
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder="例如：Biou Demo"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="自定义域名（可选）">
            <input
              value={customDomain}
              onChange={(e) => setCustomDomain(e.target.value)}
              placeholder="例如：shop.example.com"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="基础模板（仅显示已发布）">
            {tplLoading ? (
              <LoadingBlock />
            ) : tplError ? (
              <ErrorBanner message={tplError} />
            ) : templates.length === 0 ? (
              <EmptyState title="暂无已发布模板" hint="请先在 /templates 上传一个版本并发布" />
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {templates.map((t) => {
                  const sel = templateId === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTemplateId(t.id)}
                      className={
                        "rounded-md border p-3 text-left transition-colors " +
                        (sel
                          ? "border-primary bg-primary/5"
                          : "hover:border-zinc-400")
                      }
                    >
                      <div className="font-medium">{t.name}</div>
                      <div className="text-xs text-muted-foreground">
                        code: {t.code} · category: {t.category ?? "-"}
                      </div>
                      {t.description && (
                        <div className="mt-1 text-xs text-muted-foreground line-clamp-2">
                          {t.description}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </Field>
        </section>
      )}

      {/* Step 2 */}
      {step === 2 && (
        <section className="space-y-4 rounded-lg border bg-background p-5">
          <h2 className="text-lg font-medium">Step 2 · 替换规则</h2>
          <p className="text-xs text-muted-foreground">
            从所选模板的 default_replace_rules 派生；可增删改。最终会作为 saga.start 的{" "}
            <code className="rounded bg-muted px-1 font-mono">replaceRules</code> 字段。
            {defaultVersion && (
              <span>
                {" "}
                当前模板版本：
                <code className="rounded bg-muted px-1 font-mono">
                  {defaultVersion.version}
                </code>
              </span>
            )}
          </p>
          <div className="space-y-2">
            {rules.map((r, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={r.key}
                  onChange={(e) => setRuleKV(i, e.target.value, r.value)}
                  placeholder="key (如 BRAND_NAME)"
                  className="w-64 rounded-md border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <input
                  value={r.value}
                  onChange={(e) => setRuleKV(i, r.key, e.target.value)}
                  placeholder="value"
                  className="flex-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={() => removeRule(i)}
                  className="rounded-md border px-3 py-2 text-xs text-destructive hover:bg-destructive/10"
                >
                  删除
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addRule}
              className="rounded-md border border-dashed px-3 py-2 text-xs hover:bg-accent"
            >
              + 新增规则
            </button>
          </div>
        </section>
      )}

      {/* Step 3 */}
      {step === 3 && (
        <section className="space-y-4 rounded-lg border bg-background p-5">
          <h2 className="text-lg font-medium">Step 3 · 店铺接入</h2>
          <div className="flex gap-2 text-sm">
            {(["oauth", "mock"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={
                  "rounded-md border px-4 py-2 transition-colors " +
                  (mode === m
                    ? "border-primary bg-primary text-primary-foreground"
                    : "")
                }
              >
                {m === "oauth" ? "Shopify OAuth（生产）" : "Dev Mock（开发）"}
              </button>
            ))}
          </div>
          {mode === "oauth" ? (
            <Field label="店铺域名提示（shopDomainHint）">
              <input
                value={shopDomainHint}
                onChange={(e) => setShopDomainHint(e.target.value)}
                placeholder="demo-store.myshopify.com"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                启动后将跳转到 Shopify 授权页。
              </p>
            </Field>
          ) : (
            <>
              <Field label="店铺域名">
                <input
                  value={mockShopDomain}
                  onChange={(e) => setMockShopDomain(e.target.value)}
                  placeholder="dev-store.myshopify.com"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </Field>
              <Field label="Access Token">
                <input
                  value={mockAccessToken}
                  onChange={(e) => setMockAccessToken(e.target.value)}
                  placeholder="shpat_xxx"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </Field>
            </>
          )}
        </section>
      )}

      {/* Step 4 */}
      {step === 4 && (
        <section className="space-y-3 rounded-lg border bg-background p-5">
          <h2 className="text-lg font-medium">Step 4 · 选产品</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setPPage(1);
            }}
            className="flex gap-2 text-sm"
          >
            <input
              value={pKeyword}
              onChange={(e) => setPKeyword(e.target.value)}
              placeholder="搜索 handle / title…"
              className="flex-1 rounded-md border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="submit"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              搜索
            </button>
          </form>

          <ErrorBanner message={pError} />

          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2"></th>
                  <th className="px-3 py-2 text-left">ID</th>
                  <th className="px-3 py-2 text-left">Handle</th>
                  <th className="px-3 py-2 text-left">标题</th>
                  <th className="px-3 py-2 text-left">Vendor</th>
                </tr>
              </thead>
              <tbody>
                {pLoading && (
                  <tr>
                    <td colSpan={5} className="px-3 py-2">
                      <LoadingBlock />
                    </td>
                  </tr>
                )}
                {!pLoading && products.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-2">
                      <EmptyState title="无产品" />
                    </td>
                  </tr>
                )}
                {products.map((p) => {
                  const checked = selected.has(p.id);
                  return (
                    <tr
                      key={p.id}
                      className={
                        "border-t hover:bg-muted/30 " +
                        (checked ? "bg-primary/5" : "")
                      }
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleProduct(p.id)}
                        />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{p.id}</td>
                      <td className="px-3 py-2 font-mono text-xs">{p.handle}</td>
                      <td className="px-3 py-2">{p.title}</td>
                      <td className="px-3 py-2 text-xs">{p.vendor || "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              共 {pTotal} 条 · 已选 {selected.size}
            </span>
            <div className="flex gap-2">
              <button
                disabled={pPage <= 1}
                onClick={() => setPPage((x) => x - 1)}
                className="rounded-md border px-3 py-1 disabled:opacity-50"
              >
                上一页
              </button>
              <span>
                第 {pPage} / {Math.max(1, Math.ceil(pTotal / pSize))} 页
              </span>
              <button
                disabled={pPage * pSize >= pTotal}
                onClick={() => setPPage((x) => x + 1)}
                className="rounded-md border px-3 py-1 disabled:opacity-50"
              >
                下一页
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Step 5 */}
      {step === 5 && (
        <section className="space-y-3 rounded-lg border bg-background p-5">
          <h2 className="text-lg font-medium">Step 5 · 确认 + 启动</h2>
          <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-2">
            <Summary label="分公司 ID" value={tenantId} />
            <Summary label="品牌名" value={brandName || "-"} />
            <Summary label="自定义域名" value={customDomain || "-"} />
            <Summary
              label="基础模板"
              value={selectedTemplate ? `#${selectedTemplate.id} ${selectedTemplate.name}` : "-"}
            />
            <Summary
              label="模板版本"
              value={defaultVersion ? defaultVersion.version : "-"}
            />
            <Summary label="替换规则数" value={rules.filter((r) => r.key.trim()).length} />
            <Summary label="接入模式" value={mode === "oauth" ? "Shopify OAuth" : "Dev Mock"} />
            <Summary
              label={mode === "oauth" ? "shopDomainHint" : "店铺域名"}
              value={mode === "oauth" ? shopDomainHint || "-" : mockShopDomain || "-"}
            />
            <Summary label="选中产品数" value={selected.size} />
          </dl>

          <ErrorBanner message={submitError} />

          <div className="pt-2">
            <button
              type="button"
              disabled={submitting}
              onClick={handleStart}
              className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Spinner /> 启动中…
                </>
              ) : (
                "启动 saga"
              )}
            </button>
            <p className="mt-2 text-xs text-muted-foreground">
              {mode === "oauth"
                ? "OAuth 模式：成功后跳转 Shopify 授权页；授权完成后回调由后端处理。"
                : "Dev Mock 模式：成功后会自动调用 dev-mock-auth 推进至 AUTH_DONE，并跳到进度页。"}
            </p>
          </div>
        </section>
      )}

      {/* nav buttons */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={prev}
          disabled={step === 1}
          className="rounded-md border px-4 py-2 text-sm disabled:opacity-50"
        >
          ← 上一步
        </button>
        {step < 5 && (
          <button
            type="button"
            onClick={next}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            下一步 →
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b py-1.5 last:border-b-0">
      <dt className="text-xs uppercase text-muted-foreground">{label}</dt>
      <dd className="break-all text-right">{value}</dd>
    </div>
  );
}
