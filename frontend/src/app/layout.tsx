import type { Metadata } from "next";
import { Gabarito } from "next/font/google";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";
import "@/style/globals.css";
import { Providers } from "./providers";

const gabarito = Gabarito({ subsets: ["latin"], variable: "--font-gabarito" });

export const metadata: Metadata = {
  title: siteConfig.title,
  description: siteConfig.description,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={cn("bg-background font-sans", gabarito.variable)}>
        {/*
          SideNav 已移至 src/app/(app)/layout.tsx
          登录页 (auth) 不需要导航栏，因此根布局只保留全局 Providers
        */}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
