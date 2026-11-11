import LiveRefresh from "@/components/LiveRefresh";

export default function ResultsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LiveRefresh seconds={10} />
      {children}
    </>
  );
}
