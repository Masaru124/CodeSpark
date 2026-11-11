import LiveRefresh from "@/components/LiveRefresh";

export default function PassLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LiveRefresh />
      {children}
    </>
  );
}
