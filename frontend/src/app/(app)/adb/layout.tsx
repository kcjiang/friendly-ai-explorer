import { TopNav } from "@/components/nav";

export default function AdbLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-screen">
      <TopNav title="ADB 调试（WebUSB）" />
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
