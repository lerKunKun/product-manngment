"use client";

// TODO i18n
import { useEffect, useState } from "react";
import { utilApi, type UsdCnyRate } from "@/lib/api/util";

const RATE_REFRESH_MS = 5 * 60 * 1000; // 5min（后端 redis 已缓存 1h，这里只是触发取新值）
const CLOCK_REFRESH_MS = 1000;

const FMT_CN = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const FMT_US = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/**
 * 顶栏信息条：USD/CNY 汇率 + 北京（GMT+8）+ 洛杉矶（GMT-8 / GMT-7 夏令时）双时区时间。
 * - 汇率走后端 /util/usd-cny-rate（Redis 1h 缓存），前端 5 分钟刷一次
 * - 时间纯客户端 Intl.DateTimeFormat 算时区，每秒刷
 */
export function HeaderInfoBar() {
  const [rate, setRate] = useState<UsdCnyRate | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await utilApi.usdCnyRate();
        if (alive) setRate(r);
      } catch {
        if (alive) setRate({ rate: null, fetchedAt: Date.now(), source: "error" });
      }
    }
    load();
    const t = setInterval(load, RATE_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), CLOCK_REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  const rateLabel =
    rate && rate.rate != null
      ? `1 USD = ${Number(rate.rate).toFixed(4)} CNY`
      : "汇率获取中…";
  const rateTitle = rate?.fetchedAt
    ? `数据源：${rate.source}\n更新于：${new Date(rate.fetchedAt).toLocaleString("zh-CN")}`
    : "";

  return (
    <div className="hidden items-center gap-3 text-xs text-muted-foreground md:flex">
      {/* USD/CNY 汇率 */}
      <span
        className="rounded border bg-muted/30 px-2 py-1 font-mono tabular-nums"
        title={rateTitle}
      >
        {rateLabel}
      </span>
      {/* 北京时间 GMT+8 */}
      <span className="font-mono tabular-nums">
        <span className="mr-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-400">
          BJ
        </span>
        {FMT_CN.format(now)} <span className="opacity-60">GMT+8</span>
      </span>
      {/* 洛杉矶时间 GMT-8（夏令时 -7，浏览器 Intl 自动处理） */}
      <span className="font-mono tabular-nums">
        <span className="mr-1 rounded bg-blue-500/15 px-1.5 py-0.5 text-blue-700 dark:text-blue-400">
          LA
        </span>
        {FMT_US.format(now)} <span className="opacity-60">GMT-8</span>
      </span>
    </div>
  );
}
