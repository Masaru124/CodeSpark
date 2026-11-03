import { headers } from "next/headers";

/**
 * Absolute origin for shareable pass links. Derived from the request, never
 * from user input, so it cannot be pointed at another host.
 */
export async function baseUrl(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const proto =
    headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
