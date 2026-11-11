import Papa from "papaparse";
import { apiRole } from "@/lib/session";
import { q } from "@/lib/db";
import { EXPORTS } from "@/lib/exports";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await apiRole("admin");
  if (!session) return new Response("Unauthorized", { status: 401 });

  const type = new URL(request.url).searchParams.get("type") ?? "results";

  if (type === "all") {
    const dump: Record<string, unknown> = {
      exported_at: new Date().toISOString(),
      exported_by: session.label,
      tables: {},
    };
    const tables = dump.tables as Record<string, unknown[]>;
    for (const [key, definition] of Object.entries(EXPORTS)) {
      tables[key] = await q(definition.sql);
    }
    return new Response(JSON.stringify(dump, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="codespark-all-data.json"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const definition = EXPORTS[type];
  if (!definition) return new Response("Unknown export type", { status: 400 });

  const rows = await q(definition.sql);
  const csv = Papa.unparse(rows as never[], { quotes: true });
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${definition.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
