"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Polls the database revision and re-renders the current server components in
 * place when anything changed. Pauses while a form field is focused or a file
 * is selected, and never refreshes an in-progress judge score sheet.
 */
export default function LiveRefresh({
  seconds = 5,
  label = false,
}: {
  seconds?: number;
  label?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const revision = useRef<number | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const stamp = () =>
      setUpdatedAt(new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }));

    const editing = () => {
      const active = document.activeElement as HTMLElement | null;
      if (active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)) return true;
      const file = document.querySelector<HTMLInputElement>('input[type="file"]');
      return Boolean(file?.files?.length);
    };
    const scoreSheet = /^\/judge\/[^/]+$/.test(pathname);

    const check = async () => {
      if (cancelled || document.hidden || busy.current || scoreSheet) return;
      try {
        const response = await fetch("/api/live", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { rev?: number };
        const rev = Number(data.rev ?? 0);
        if (revision.current === null) {
          revision.current = rev;
          return;
        }
        if (rev === revision.current) return;
        if (editing()) return;
        revision.current = rev;
        busy.current = true;
        router.refresh();
        stamp();
        window.setTimeout(() => {
          busy.current = false;
        }, 1500);
      } catch {
        // Offline or mid-deploy; the next tick retries.
      }
    };

    void check();
    const timer = window.setInterval(check, seconds * 1000);
    const onVisible = () => {
      if (!document.hidden) void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [pathname, router, seconds]);

  if (!label) return null;

  return (
    <span className="flex items-center gap-2 text-xs text-ink-500">
      <span className="hidden sm:inline">
        Live{updatedAt ? ` · updated ${updatedAt}` : ""}
      </span>
      <button
        type="button"
        className="btn-ghost text-xs"
        onClick={() => {
          router.refresh();
          setUpdatedAt(new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }));
        }}
      >
        Refresh now
      </button>
    </span>
  );
}
