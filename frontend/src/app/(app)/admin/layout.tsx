import { TopNav } from "@/components/nav";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TopNav title="管理后台" />
      <main>{children}</main>
    </>
  );
}
