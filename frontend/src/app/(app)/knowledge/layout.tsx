import { TopNav } from "@/components/nav";

export default function KnowledgeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-screen">
      <TopNav title="知识库" />
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
