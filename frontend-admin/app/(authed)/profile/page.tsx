"use client";

import { useEffect, useState } from "react";
import { userApi, type Me } from "@/lib/api/user";
import type { ApiError } from "@/lib/api/client";
import { authApi, type SessionView } from "@/lib/api/auth";
import {
  notificationApi,
  CATEGORY_LABEL,
  CHANNELS,
  CHANNEL_LABEL,
  type NotificationEventDef,
  type NotificationSubscription,
} from "@/lib/api/notification";
import { useI18n } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { UnbindDingtalkDialog } from "./_components/UnbindDingtalkDialog";

export default function ProfilePage() {
  const { t } = useI18n();
  const toast = useToast();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 修改密码状态
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [pwdMsg, setPwdMsg] = useState("");
  const [pwdBusy, setPwdBusy] = useState(false);

  // 解绑钉钉对话框（含钉钉验证码 + 设置新密码）
  const [unbindOpen, setUnbindOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setMe(await userApi.me());
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // 钉钉绑定回调：?bound=1 / ?error=...
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const bound = url.searchParams.get("bound");
    const err = url.searchParams.get("error");
    if (!bound && !err) return;

    if (bound === "1") {
      toast.success(t("profile.dingtalk.boundOk"));
      load();
    } else if (err) {
      toast.error(t("profile.dingtalk.bindFailed").replace("{reason}", err));
    }
    // 清掉 query，避免刷新重复触发
    url.searchParams.delete("bound");
    url.searchParams.delete("error");
    window.history.replaceState({}, "", url.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function changePwd(e: React.FormEvent) {
    e.preventDefault();
    setPwdMsg("");
    if (newPwd !== confirmPwd) {
      setPwdMsg(t("profile.password.mismatch"));
      return;
    }
    if (newPwd.length < 8) {
      setPwdMsg(t("profile.password.tooShort"));
      return;
    }
    const isFirstSet = me?.hasPassword === false;
    setPwdBusy(true);
    try {
      await userApi.changePassword(newPwd, isFirstSet ? undefined : oldPwd);
      setPwdMsg(t(isFirstSet ? "profile.password.successSet" : "profile.password.success"));
      setOldPwd("");
      setNewPwd("");
      setConfirmPwd("");
      load();
    } catch (e) {
      setPwdMsg((e as ApiError).message);
    } finally {
      setPwdBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!me) return null;

  const successMsgs = [t("profile.password.success"), t("profile.password.successSet")];
  const isFirstSet = me.hasPassword === false;

  async function bindDingtalk() {
    try {
      // 用专用 bind 接口，**不**走登录路径（避免切换账号）
      const r = await authApi.dingtalkBindQrcode();
      window.location.href = r.oauthUrl;
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  function startUnbindDingtalk() {
    setUnbindOpen(true);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">{t("profile.title")}</h1>

      <div className="flex items-center gap-4 rounded-lg border bg-background p-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={me.avatarUrl || "/assets/defaults/avatar.png"}
          alt={me.username}
          className="h-20 w-20 rounded-full object-cover ring-1 ring-border"
        />
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">{me.username}</div>
          <div className="truncate text-sm text-muted-foreground">{me.email || "-"}</div>
        </div>
      </div>

      <section className="rounded-lg border bg-background p-5">
        <h2 className="mb-3 text-base font-medium">{t("profile.basicInfo")}</h2>
        <dl className="space-y-2 text-sm">
          <Row label={t("profile.field.employeeNo")} value={me.employeeNo} />
          <Row label={t("profile.field.companyName")} value={me.companyName ?? "-"} />
          <Row label={t("profile.field.position")} value={me.position ?? "-"} />
          <Row label={t("profile.field.username")} value={me.username} />
          <Row label={t("profile.field.email")} value={me.email || "-"} />
          <Row label="电话" value={me.phone || "-"} />
          <Row
            label={t("profile.field.userType")}
            value={me.userType === "TEMP" ? t("profile.userType.temp") : t("profile.userType.full")}
          />
          <Row label={t("profile.field.status")} value={me.status} />
          {me.expiresAt && (
            <Row
              label={t("profile.field.expiresAt")}
              value={new Date(me.expiresAt).toLocaleString("zh-CN")}
            />
          )}
          <Row
            label={t("profile.field.dingtalkBound")}
            value={
              me.dingtalkUserId ? (
                <span className="inline-flex items-center gap-2">
                  <span>{t("profile.dingtalk.bound")}</span>
                  <button
                    type="button"
                    onClick={startUnbindDingtalk}
                    className="rounded-md border border-red-200 bg-background px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50"
                  >
                    解绑
                  </button>
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <span>{t("profile.dingtalk.unbound")}</span>
                  <button
                    type="button"
                    onClick={bindDingtalk}
                    className="rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground"
                  >
                    {t("profile.dingtalk.bindBtn")}
                  </button>
                </span>
              )
            }
          />
        </dl>
        {me.passwordMustChange && me.hasPassword && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            {t("profile.passwordMustChangeWarn")}
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-background p-5">
        <h2 className="mb-1 text-base font-medium">
          {isFirstSet ? t("profile.setPassword") : t("profile.changePassword")}
        </h2>
        {isFirstSet && (
          <p className="mb-3 text-xs text-muted-foreground">{t("profile.setPasswordHint")}</p>
        )}
        <form onSubmit={changePwd} className="space-y-4">
          {!isFirstSet && (
            <Field label={t("profile.password.old")}>
              <input
                type="password"
                value={oldPwd}
                onChange={(e) => setOldPwd(e.target.value)}
                required
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
          )}
          <Field label={t("profile.password.new")}>
            <input
              type="password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              required
              minLength={8}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label={t("profile.password.confirm")}>
            <input
              type="password"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              required
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          {pwdMsg && (
            <p className={"text-sm " + (successMsgs.includes(pwdMsg) ? "text-emerald-700" : "text-destructive")}>
              {pwdMsg}
            </p>
          )}
          <button
            type="submit"
            disabled={pwdBusy}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {pwdBusy
              ? t("profile.password.submitting")
              : isFirstSet
                ? t("profile.password.submitSet")
                : t("profile.password.submit")}
          </button>
        </form>
      </section>

      <SessionsSection />
      <SubscriptionSection />

      <UnbindDingtalkDialog
        open={unbindOpen}
        onClose={() => setUnbindOpen(false)}
        onUnbound={() => {
          setUnbindOpen(false);
          load();
        }}
      />
    </div>
  );
}

function SessionsSection() {
  const { t } = useI18n();
  const [list, setList] = useState<SessionView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const data = await authApi.sessions();
      setList(data ?? []);
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function kickOthers() {
    if (!confirm(t("profile.sessions.confirmKick"))) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await authApi.kickOthers();
      setMsg(t("profile.sessions.kicked").replace("{count}", String(r.kicked)));
      await load();
    } catch (e) {
      setMsg((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  const otherCount = (list ?? []).filter((s) => !s.current).length;

  return (
    <section className="rounded-lg border bg-background p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-medium">{t("profile.sessions.title")}</h2>
        <button
          onClick={kickOthers}
          disabled={busy || otherCount === 0}
          className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground disabled:opacity-50"
        >
          {busy ? t("profile.sessions.kicking") : t("profile.sessions.kickOthers")}
        </button>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        {t("profile.sessions.hint")}
      </p>
      {msg && (
        <p className="mb-3 text-xs text-emerald-700">{msg}</p>
      )}
      {err && (
        <p className="mb-3 text-xs text-destructive">{err}</p>
      )}
      {loading ? (
        <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
      ) : !list || list.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("profile.sessions.empty")}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {list.map((s) => (
            <li key={s.info.sid} className="flex items-start justify-between gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {s.info.label}
                  {s.current && (
                    <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                      {t("profile.sessions.current")}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground" title={s.info.userAgent}>
                  {s.info.userAgent || "-"}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span>IP：{s.info.ip || "-"}</span>
                  <span>
                    {t("profile.sessions.loginAt")}：
                    {new Date(s.info.loginAt).toLocaleString("zh-CN")}
                  </span>
                  <span>
                    {t("profile.sessions.lastSeen")}：
                    {new Date(s.info.lastSeenAt).toLocaleString("zh-CN")}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SubscriptionSection() {
  const { t } = useI18n();
  const [events, setEvents] = useState<Record<string, NotificationEventDef[]>>({});
  const [subs, setSubs] = useState<Record<string, NotificationSubscription>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [evMap, subList] = await Promise.all([
          notificationApi.listEvents(),
          notificationApi.getMySubscriptions(),
        ]);
        setEvents(evMap ?? {});
        const m: Record<string, NotificationSubscription> = {};
        for (const s of subList ?? []) m[s.eventCode] = { ...s };
        setSubs(m);
      } catch (e) {
        setMsg((e as ApiError).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function toggleChannel(code: string, ch: string) {
    setSubs((prev) => {
      const cur = prev[code];
      if (!cur) return prev;
      const set = new Set(
        cur.channels
          ? cur.channels.split(",").map((c) => c.trim()).filter(Boolean)
          : []
      );
      if (set.has(ch)) set.delete(ch);
      else set.add(ch);
      return { ...prev, [code]: { ...cur, channels: Array.from(set).join(",") } };
    });
  }

  function toggleEnabled(code: string) {
    setSubs((prev) => {
      const cur = prev[code];
      if (!cur) return prev;
      return { ...prev, [code]: { ...cur, enabled: !cur.enabled } };
    });
  }

  async function save() {
    setBusy(true);
    setMsg("");
    try {
      await notificationApi.updateMySubscriptions(Object.values(subs));
      setMsg(t("profile.subscriptions.saved"));
    } catch (e) {
      setMsg((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <section className="rounded-lg border bg-background p-5">
        <h2 className="mb-3 text-base font-medium">{t("profile.subscriptions")}</h2>
        <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
      </section>
    );
  }

  const savedMsg = t("profile.subscriptions.saved");
  const cats = Object.keys(events);
  return (
    <section className="rounded-lg border bg-background p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-medium">{t("profile.subscriptions")}</h2>
        <button
          onClick={save}
          disabled={busy}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? t("profile.subscriptions.saving") : t("profile.subscriptions.save")}
        </button>
      </div>
      {msg && (
        <p
          className={
            "mb-3 text-xs " +
            (msg === savedMsg ? "text-emerald-700" : "text-destructive")
          }
        >
          {msg}
        </p>
      )}
      <p className="mb-4 text-xs text-muted-foreground">
        {t("profile.subscriptions.hint")}
      </p>
      <div className="space-y-4">
        {cats.map((cat) => (
          <details key={cat} open className="rounded-md border">
            <summary className="cursor-pointer bg-muted/30 px-3 py-2 text-sm font-medium">
              {CATEGORY_LABEL[cat] ?? cat}
              <span className="ml-2 text-xs text-muted-foreground">
                {t("profile.subscriptions.eventCount").replace("{count}", String(events[cat].length))}
              </span>
            </summary>
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">{t("profile.subscriptions.col.event")}</th>
                  <th className="px-2 py-2 text-center font-medium">{t("profile.subscriptions.col.enabled")}</th>
                  {CHANNELS.map((c) => (
                    <th key={c} className="px-2 py-2 text-center font-medium">
                      {CHANNEL_LABEL[c]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events[cat].map((d) => {
                  const s = subs[d.code];
                  const channels = (s?.channels ?? d.defaultChannels ?? "")
                    .split(",")
                    .map((x) => x.trim());
                  const enabled = s?.enabled ?? d.defaultSubscribed;
                  return (
                    <tr key={d.code} className="border-t">
                      <td className="px-3 py-2">
                        <div className="font-medium">{d.name}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {d.code}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={() => toggleEnabled(d.code)}
                        />
                      </td>
                      {CHANNELS.map((ch) => (
                        <td key={ch} className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={channels.includes(ch)}
                            disabled={!enabled}
                            onChange={() => toggleChannel(d.code, ch)}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </details>
        ))}
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono text-xs">{value}</dd>
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
