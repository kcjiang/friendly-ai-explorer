"use client";

import { ChevronDown, LogOut, User as UserIcon } from "lucide-react";
import { useSession, signOut } from "next-auth/react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ROLE_LABELS: Record<string, string> = {
  developer: "DEV",
  leader:    "Manager",
  engineer:  "FAE",
};

/**
 * 字符串 → 稳定 hash
 */
function stringToHash(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return hash;
}

/**
 * 生成 HSL 渐变头像（稳定 + 美观）
 */
function getAvatarGradient(name: string) {
  const hash = stringToHash(name);

  // 主色相
  const hue = Math.abs(hash) % 360;

  // 渐变第二个色相（偏移，保证层次）
  const hue2 = (hue + 40) % 360;

  // 控制亮度，避免过暗/过亮
  const lightnessBase = 55 + (Math.abs(hash) % 10); // 55~65
  const lightness2 = lightnessBase + 10;

  const saturation = 65;

  return {
    background: `linear-gradient(135deg, 
      hsl(${hue}, ${saturation}%, ${lightnessBase}%),
      hsl(${hue2}, ${saturation}%, ${lightness2}%)
    )`,
  };
}

export default function User() {
  const { data: session } = useSession();

  const name = session?.user?.name ?? "Loading...";
  const roleKey = session?.user?.role ?? "Guest";
  const roleLabel = ROLE_LABELS[roleKey] ?? "Loading...";

  const initial = name?.[0]?.toUpperCase() ?? "L";
  const avatarStyle = getAvatarGradient(name);

  return (
    <div className="flex h-16 items-center border-b border-border px-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <div className="flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-1 hover:bg-slate-200 dark:hover:bg-slate-800">
            
            {/* 左侧用户信息 */}
            <div className="flex items-center">
              
              {/* 动态渐变头像 */}
              <div
                style={avatarStyle}
                className="mr-2 flex h-9 w-9 items-center justify-center rounded-full 
                           text-sm font-bold text-white"
              >
                {initial}
              </div>

              <div className="flex flex-col">
                <span className="text-sm font-medium">{name}</span>
                <span className="text-xs text-muted-foreground">{roleLabel}</span>
              </div>
            </div>
            <ChevronDown size={16} />
          </div>
        </DropdownMenuTrigger>

        {/* 下拉菜单 */}
        <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
          
          {/* 用户信息 */}
          <DropdownMenuItem
            onClick={() => {
              console.log("go to profile");
              // TODO: 跳转用户页面
            }}
            className="cursor-pointer"
          >
            <UserIcon size={16} className="mr-2" />
            用户信息
          </DropdownMenuItem>

          {/* 退出登录 */}
          <DropdownMenuItem
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="cursor-pointer text-red-500 focus:text-red-500"
          >
            <LogOut size={16} className="mr-2" />
            退出登录
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
