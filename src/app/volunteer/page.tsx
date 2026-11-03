import { requireRole } from "@/lib/session";
import { getConfig } from "@/lib/config";
import Scanner from "./Scanner";

export const dynamic = "force-dynamic";
export const metadata = { title: "Scanner" };

export default async function VolunteerPage() {
  const session = await requireRole("volunteer", "admin");
  const config = await getConfig();

  return (
    <Scanner
      volunteer={session.label}
      eventName={config.event.name}
      deadline={config.event.submission_deadline}
    />
  );
}
