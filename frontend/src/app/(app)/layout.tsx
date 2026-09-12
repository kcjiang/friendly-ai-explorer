import { SideNav } from "@/components/nav";
import AiChatPanel from "@/components/ai/chat-panel";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh]">
      <SideNav />
      <div className="flex-grow overflow-auto">{children}</div>
      {/* 全局浮动 AI 助手，所有页面均可使用 */}
      <AiChatPanel />
    </div>
  );
}
