import { TopNav } from "@/components/nav";

export default function SerialLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-screen">
      <TopNav title="串口调试（Web Serial）" />
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
