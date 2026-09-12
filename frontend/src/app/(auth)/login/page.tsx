"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (res?.error) {
      setError("邮箱或密码错误，请重试");
    } else {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <div className="relative min-h-screen flex flex-col">
      {/* 背景 */}
      <div
        className="fixed inset-0 -z-10 bg-cover bg-center"
        style={{ backgroundImage: "url(/images/background_image.jpg)" }}
      />

      {/* TopNav */}
      <div className="flex h-16 items-center justify-between px-6 border-b border-border backdrop-blur-sm bg-background/60">
        {/* 左：logo */}
        <div className="flex items-center">
          <img
            src="/images/sdmc_logo.svg"
            alt="SDMC Logo"
            className="h-8 w-auto dark:invert"
          />
        </div>

        {/* 右：主题切换 */}
        <ThemeToggle />
      </div>

      {/* 中间内容 */}
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="w-full max-w-xs">
          {/* 登录卡片 */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-950">
            
            {/* logo（需适配暗黑模式） */}
            <div className="mb-6 flex justify-center">
              <img
                src="/images/fae_logo.svg"
                alt="FAE Logo"
                className="h-10 w-auto dark:invert"
              />
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* 邮箱 */}
              <div className="space-y-1.5">
                <label className="text-sm text-slate-700 dark:text-slate-300">
                  邮箱地址
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-ring dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>

              {/* 密码 */}
              <div className="space-y-1.5">
                <label className="text-sm text-slate-700 dark:text-slate-300">
                  密码
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-ring dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>

              {/* 错误提示 */}
              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              {/* 登录按钮 */}
              <Button className="w-full" disabled={loading}>
                {loading ? "登录中..." : "登 录"}
              </Button>

              {/* 分割线 */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                OR
                <div className="h-px flex-1 bg-border" />
              </div>

              {/* 钉钉登录 */}
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => signIn("dingtalk")}
              >
                钉钉登录
              </Button>
            </form>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="py-4 text-center text-xs text-slate-600 dark:text-slate-400">
        ©2003-2026 SDMC Technology Co., Ltd
      </div>
    </div>
  );
}