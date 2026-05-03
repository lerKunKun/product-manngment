"use client";

import { useEffect, useState } from "react";
import { userApi, type Me } from "@/lib/api/user";
import type { ApiError } from "@/lib/api/client";
import {
  notificationApi,
  CATEGORY_LABEL,
  CHANNELS,
  CHANNEL_LABEL,
  type NotificationEventDef,
  type NotificationSubscription,
} from "@/lib/api/notification";
import { useI18n } from "@/lib/i18n/context";

export default function ProfilePage() {
  const { t } = useI18n();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 修改密码状态
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [pwdMsg, setPwdMsg] = useState("");
  const [pwdBusy, setPwdBusy] = useState(false);

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
    setPwdBusy(true);
    try {
      await userApi.changePassword(oldPwd, newPwd);
      setPwdMsg(t("profile.password.success"));
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

  const successPrefix = t("profile.password.success");
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">{t("profile.title")}</h1>

      <section className="rounded-lg border bg-background p-5">
        <h2 className="mb-3 text-base font-medium">{t("profile.basicInfo")}</h2>
        <dl className="space-y-2 text-sm">
          <Row label={t("profile.field.employeeNo")} value={me.employeeNo} />
          <Row label={t("profile.field.username")} value={me.username} />
          <Row label={t("profile.field.email")} value={me.email || "-"} />
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
            value={me.dingtalkUserId ? t("profile.dingtalk.bound") : t("profile.dingtalk.unbound")}
          />
        </dl>
        {me.passwordMustChange && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            {t("profile.passwordMustChangeWarn")}
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-background p-5">
        <h2 className="mb-3 text-base font-medium">{t("profile.changePassword")}</h2>
        <form onSubmit={changePwd} className="space-y-4">
          <Field label={t("profile.password.old")}>
            <input
              type="password"
              value={oldPwd}
              onChange={(e) => setOldPwd(e.target.value)}
              required
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
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
            <p className={"text-sm " + (pwdMsg === successPrefix ? "text-emerald-700" : "text-destructive")}>
              {pwdMsg}
            </p>
          )}
          <button
            type="submit"
            disabled={pwdBusy}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {pwdBusy ? t("profile.password.submitting") : t("profile.password.submit")}
          </button>
        </form>
      </section>

      <SubscriptionSection />
    </div>
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
