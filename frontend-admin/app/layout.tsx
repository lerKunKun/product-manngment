import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ui/Toast";

export const metadata: Metadata = {
  title: "Biou x Shopify Control Center",
  description: "Shopify multi-store asset & one-click store provisioning hub",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try { var t = localStorage.getItem("theme"); var d = t === "dark" || (!t && window.matchMedia("(prefers-color-scheme: dark)").matches); if (d) document.documentElement.classList.add("dark"); } catch (e) {}`,
          }}
        />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
