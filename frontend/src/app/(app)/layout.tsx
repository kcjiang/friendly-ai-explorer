import AiChatPanel from "@/components/ai/chat-panel";
import DeviceTools from "@/components/debug/device-tools";
import UploadTaskHost from "@/components/files/upload-task-host";
import { SideNav } from "@/components/nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh]">
      <SideNav />
      <div className="min-w-0 flex-grow overflow-auto">
        <DeviceTools />
        {children}
      </div>
      {/* 全局浮动 AI 助手，所有页面均可使用 */}
      <AiChatPanel />
      <UploadTaskHost />
    </div>
  );
}
