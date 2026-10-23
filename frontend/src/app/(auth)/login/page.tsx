"use client";
import { useUiTranslations } from "@/i18n/client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { BrandLogo } from "@/components/brand-logo";
import { ThemeToggle } from "@/components/theme-toggle";

export default function LoginPage() {
  const t = useUiTranslations();

  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      const res = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (!res || res.error) {
        setError(t("ui.incorrectEmailOrPasswordTryAgain"));
      } else {
        router.push("/");
        router.refresh();
      }
    } catch {
      setError(t("ui.cannotConnectToTheSignInServiceTryAgainLater"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative isolate flex min-h-svh flex-col">
      <div
        aria-hidden="true"
        className="fixed inset-0 -z-20 bg-cover bg-center"
        style={{ backgroundImage: "url(/images/background_image.jpg)" }}
      />
      <div
        aria-hidden="true"
        className="fixed inset-0 -z-10 bg-white/10 transition-colors duration-300 dark:bg-black/55"
      />
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border/60 bg-background/80 px-4 backdrop-blur-md sm:px-8">
        <BrandLogo brand="sdmc" className="h-8 w-[105px]" />
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <Card className="w-full max-w-sm shadow-xl">
          <CardHeader className="gap-2">
            <BrandLogo brand="fae" className="mb-4 h-10 w-[148px]" />
            <CardTitle>{t("ui.signInToYourAccount")}</CardTitle>
            <CardDescription>
              {t("ui.enterYourEmailAndPasswordToStartYourFaeWork")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={handleSubmit}
              className="grid gap-5"
              aria-busy={loading}
            >
              <div className="grid gap-2">
                <label htmlFor="email" className="text-sm font-medium">
                  {t("ui.emailAddress")}
                </label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
              <div className="grid gap-2">
                <label htmlFor="password" className="text-sm font-medium">
                  {t("ui.password")}
                </label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
              {error && (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {error}
                </p>
              )}
              <div className="grid gap-3">
                <Button
                  type="submit"
                  className="w-full text-white"
                  disabled={loading}
                >
                  {loading && (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  )}
                  {loading ? t("ui.signingIn") : t("ui.signIn")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled
                  aria-describedby="dingtalk-status"
                >
                  {t("ui.signInWithDingtalk")}
                </Button>
                <p
                  id="dingtalk-status"
                  className="text-center text-xs text-muted-foreground"
                >
                  {t("ui.dingtalkSignInIsComingSoon")}
                </p>
              </div>
              <p className="text-center text-sm text-muted-foreground">
                {t("ui.needAnAccountOrAPasswordResetContactYourAdministrator")}
              </p>
            </form>
          </CardContent>
        </Card>
      </main>
      <footer className="px-4 py-5 text-center text-xs text-foreground/70">
        ©2003–2026 SDMC Technology Co., Ltd
      </footer>
    </div>
  );
}
