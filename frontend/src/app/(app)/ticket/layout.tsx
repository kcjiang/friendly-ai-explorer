import { TopNav } from "@/components/nav";

export default function TicketLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <TopNav title="工单看板" />
      {/* 不使用 Container，让看板占满全宽 */}
      <main>{children}</main>
    </>
  );
}
