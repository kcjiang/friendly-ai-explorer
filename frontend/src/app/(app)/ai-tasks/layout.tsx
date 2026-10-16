import { TopNav } from "@/components/nav";

export default function AITasksLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen flex-col">
      <TopNav title="AI任务" />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
