import { auth } from "@/../auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const session = req.auth;
  const role = session?.user?.role;

  // 未登录 → 跳转登录页（登录页本身和 API 路由除外）
  if (!session && !pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // 已登录访问登录页 → 跳转首页
  if (session && pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  // Admin 页面仅开发者可访问
  if (pathname.startsWith("/admin") && role !== "developer") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // 排除静态资源、Next.js 内部路由、NextAuth API 路由
    // "/((?!_next/static|_next/image|favicon.ico|api/auth).*)",
    "/((?!_next/static|_next/image|favicon.ico|api/auth|.*\\.).*)",
    // 添加 .*\. 来排除所有带扩展名的文件
  ],
};
