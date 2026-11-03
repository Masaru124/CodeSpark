import { redirect } from "next/navigation";
import { destroySession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST() {
  await destroySession();
  redirect("/login");
}
