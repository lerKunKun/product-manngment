"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { invitationApi } from "@/lib/api/invitation";
import type { ApiError } from "@/lib/api/client";

const ROLES = [
  { code: "TEMP_STAFF", label: "临时员工（必选）", required: true },
  { code: "DESIGNER", label: "美工" },
  { code: "OPERATION", label: "运营" },
  { code: "PURCHASING", label: "采购" },
  { code: "READONLY", label: "只读" },
];

const SCOPE_TYPES: ("STORE" | "COMPANY" | "PRODUCT")[] = ["PRODUCT", "STORE", "COMPANY"];

export default function NewInvitationPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [companyId, setCompanyId] = useState<number>(1);
  const [deptId, setDeptId] = useState<string>("");
  const [roles, setRoles] = useState<Set<string>>(new Set(["TEMP_STAFF"]));
  const [scopes, setScopes] = useState<
    { scopeType: "STORE" | "COMPANY" | "PRODUCT"; scopeId: number; access: "READ" | "WRITE" }[]
  >([{ scopeType: "PRODUCT", scopeId: 1, access: "READ" }]);
  const [days, setDays] = useState<number>(30);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function toggleRole(code: string) {
    if (code === "TEMP_STAFF") return;
    const next = new Set(roles);
    next.has(code) ? next.delete(code) : next.add(code);
    setRoles(next);
  }

  function setScope(idx: number, patch: Partial<(typeof scopes)[0]>) {
    setScopes((s) => s.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (days < 1 || days > 90) {
      setError("账号有效期必须 1~90 天");
      return;
    }
    if (scopes.length === 0) {
      setError("至少 1 条数据范围");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const expires = new Date(Date.now() + days * 24 * 3600 * 1000)
        .toISOString()
        .slice(0, 19);
      await invitationApi.create({
        email,
        targetCompanyId: companyId,
        targetDeptId: deptId ? Number(deptId) : undefined,
        roleCodes: Array.from(roles),
        dataScopes: scopes,
        accountExpiresAt: expires,
        note: note || undefined,
      });
      router.push("/invitations");
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">发起邀请</h1>
      <p className="text-sm text-muted-foreground">
        角色 / 数据范围 / 过期时间 三项必填，无默认值；账号最长 90 天。
      </p>

      <form onSubmit={submit} className="space-y-5 rounded-lg border bg-background p-5">
        <Field label="受邀邮箱">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="freelancer@example.com"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="目标分公司 ID">
            <input
              type="number"
              required
              value={companyId}
              onChange={(e) => setCompanyId(Number(e.target.value))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="部门 ID（可选）">
            <input
              type="number"
              value={deptId}
              onChange={(e) => setDeptId(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
        </div>

        <Field label="角色（多选）">
          <div className="flex flex-wrap gap-2">
            {ROLES.map((r) => (
              <label
                key={r.code}
                className={
                  "cursor-pointer rounded-md border px-3 py-1.5 text-sm " +
                  (roles.has(r.code) ? "border-primary bg-primary text-primary-foreground" : "")
                }
              >
                <input
                  type="checkbox"
                  checked={roles.has(r.code)}
                  onChange={() => toggleRole(r.code)}
                  disabled={r.required}
                  className="mr-1.5 align-middle"
                />
                {r.label}
              </label>
            ))}
          </div>
        </Field>

        <Field label="数据范围">
          <div className="space-y-2">
            {scopes.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={s.scopeType}
                  onChange={(e) =>
                    setScope(i, {
                      scopeType: e.target.value as "STORE" | "COMPANY" | "PRODUCT",
                    })
                  }
                  className="rounded-md border bg-background px-2 py-1.5 text-sm"
                >
                  {SCOPE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  value={s.scopeId}
                  onChange={(e) => setScope(i, { scopeId: Number(e.target.value) })}
                  className="w-24 rounded-md border bg-background px-2 py-1.5 text-sm"
                  placeholder="ID"
                />
                <select
                  value={s.access}
                  onChange={(e) =>
                    setScope(i, { access: e.target.value as "READ" | "WRITE" })
                  }
                  className="rounded-md border bg-background px-2 py-1.5 text-sm"
                >
                  <option value="READ">READ</option>
                  <option value="WRITE">WRITE</option>
                </select>
                <button
                  type="button"
                  onClick={() => setScopes((arr) => arr.filter((_, j) => j !== i))}
                  className="rounded-md border px-2 py-1.5 text-xs hover:bg-accent"
                  disabled={scopes.length === 1}
                >
                  删除
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setScopes((arr) => [...arr, { scopeType: "PRODUCT", scopeId: 1, access: "READ" }])
              }
              className="rounded-md border border-dashed px-3 py-1.5 text-xs hover:bg-accent"
            >
              + 添加数据范围
            </button>
          </div>
        </Field>

        <Field label={`账号有效期（天，1~90）— 到期后自动失效`}>
          <input
            type="number"
            min={1}
            max={90}
            required
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="w-32 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="ml-3 text-xs text-muted-foreground">
            到期日：{new Date(Date.now() + days * 86400 * 1000).toLocaleDateString("zh-CN")}
          </span>
        </Field>

        <Field label="备注（可选）">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="例如：本期产品详情页设计合作"
          />
        </Field>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? "发送中..." : "发送邀请邮件"}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-md border px-5 py-2 text-sm hover:bg-accent"
          >
            取消
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}
