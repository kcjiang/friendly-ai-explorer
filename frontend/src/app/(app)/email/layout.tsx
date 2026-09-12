import { TopNav } from "@/components/nav";

export default function EmailLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-screen">
      <TopNav title="邮件智能分析" />
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
