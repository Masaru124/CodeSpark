const TZ = "Asia/Kolkata";

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    timeZone: TZ,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function fmtScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toFixed(2);
}

/** Compact relative time for feeds: "4m ago", "3h ago", "2d ago". */
export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(Math.abs(diff) / 60_000);
  const future = diff < 0;
  if (minutes < 1) return "just now";
  const value =
    minutes < 60
      ? `${minutes}m`
      : minutes < 1_440
        ? `${Math.round(minutes / 60)}h`
        : `${Math.round(minutes / 1_440)}d`;
  return future ? `in ${value}` : `${value} ago`;
}

export function pct(part: number, total: number): string {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

export function deadlineState(deadlineIso: string): {
  open: boolean;
  label: string;
} {
  const deadline = new Date(deadlineIso).getTime();
  const now = Date.now();
  const open = now <= deadline;
  const diff = Math.abs(deadline - now);
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  const label = open
    ? `closes in ${hours}h ${minutes}m`
    : `closed ${hours}h ${minutes}m ago`;
  return { open, label };
}

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
