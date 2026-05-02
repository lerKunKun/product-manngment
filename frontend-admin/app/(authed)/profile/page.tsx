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

export default function ProfilePage() {
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
      setPwdMsg("两次输入的新密码不一致");
      return;
    }
    if (newPwd.length < 8) {
      setPwdMsg("新密码至少 8 位");
      return;
    }
    setPwdBusy(true);
    try {
      await userApi.changePassword(oldPwd, newPwd);
      setPwdMsg("✓ 密码已修改");
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

  if (loading) return <p className="text-sm text-muted-foreground">加载中...</p>;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!me) return null;

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">个人中心</h1>

      <section className="rounded-lg border bg-background p-5">
        <h2 className="mb-3 text-base font-medium">基本信息</h2>
        <dl className="space-y-2 text-sm">
          <Row label="工号" value={me.employeeNo} />
          <Row label="用户名" value={me.username} />
          <Row label="邮箱" value={me.email || "-"} />
          <Row label="账号类型" value={me.userType === "TEMP" ? "临时账号" : "正式员工"} />
          <Row label="状态" value={me.status} />
          {me.expiresAt && (
            <Row
              label="账号有效期至"
              value={new Date(me.expiresAt).toLocaleString("zh-CN")}
            />
          )}
          <Row label="钉钉绑定" value={me.dingtalkUserId ? "已绑定" : "未绑定"} />
        </dl>
        {me.passwordMustChange && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            ⚠ 检测到您使用初始/临时密码，请立即在下方修改。
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-background p-5">
        <h2 className="mb-3 text-base font-medium">修改密码</h2>
        <form onSubmit={changePwd} className="space-y-4">
          <Field label="原密码">
            <input
              type="password"
              value={oldPwd}
              onChange={(e) => setOldPwd(e.target.value)}
              required
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="新密码（≥ 8 位）">
            <input
              type="password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              required
              minLength={8}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          <Field label="确认新密码">
            <input
              type="password"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              required
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
          {pwdMsg && (
            <p className={"text-sm " + (pwdMsg.startsWith("✓") ? "text-emerald-700" : "text-destructive")}>
              {pwdMsg}
            </p>
          )}
          <button
            type="submit"
            disabled={pwdBusy}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {pwdBusy ? "修改中..." : "确认修改"}
          </button>
        </form>
      </section>

      <SubscriptionSection />
    </div>
  );
}

function SubscriptionSection() {
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
      setMsg("✓ 订阅已保存");
    } catch (e) {
      setMsg((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <section className="rounded-lg border bg-background p-5">
        <h2 className="mb-3 text-base font-medium">通知订阅</h2>
        <p className="text-xs text-muted-foreground">加载中...</p>
      </section>
    );
  }

  const cats = Object.keys(events);
  return (
    <section className="rounded-lg border bg-background p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-medium">通知订阅</h2>
        <button
          onClick={save}
          disabled={busy}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? "保存中..." : "保存"}
        </button>
      </div>
      {msg && (
        <p
          className={
            "mb-3 text-xs " +
            (msg.startsWith("✓") ? "text-emerald-700" : "text-destructive")
          }
        >
          {msg}
        </p>
      )}
      <p className="mb-4 text-xs text-muted-foreground">
        勾选事件下要接收的通道；取消「启用」整事件不再发送（含所有通道）。
      </p>
      <div className="space-y-4">
        {cats.map((cat) => (
          <details key={cat} open className="rounded-md border">
            <summary className="cursor-pointer bg-muted/30 px-3 py-2 text-sm font-medium">
              {CATEGORY_LABEL[cat] ?? cat}
              <span className="ml-2 text-xs text-muted-foreground">
                {events[cat].length} 个事件
              </span>
            </summary>
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">事件</th>
                  <th className="px-2 py-2 text-center font-medium">启用</th>
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
