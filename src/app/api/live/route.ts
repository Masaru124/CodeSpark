import { json } from "@/lib/api";
import { liveRevision } from "@/lib/live";

export const dynamic = "force-dynamic";

/** Public, tiny: the client compares `rev` and refreshes the page on change. */
export async function GET() {
  return json({ rev: await liveRevision(), at: new Date().toISOString() });
}
