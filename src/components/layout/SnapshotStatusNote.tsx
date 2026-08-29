"use client";

import { IconCloudDownload, IconDatabaseOff, IconRefresh } from "@tabler/icons-react";
import { SNAPSHOT_REFRESH_MS, type SnapshotState } from "@/lib/use-snapshot";

/**
 * One line under every filter sidebar saying where the numbers came from.
 *
 * A dataset cached in the browser and refreshed on a timer is invisible
 * otherwise: filters answer instantly whether the data is a minute or an hour
 * old, and there is nothing on screen to tell the two apart. This says which
 * copy is being filtered and when it was last checked against MongoDB, and
 * gives a way to check again without reloading the page.
 */
const timeFormat = new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit" });

export default function SnapshotStatusNote({ snapshot }: { snapshot: SnapshotState }) {
  const { status, syncedAtMs, error, refresh } = snapshot;
  const minutes = Math.round(SNAPSHOT_REFRESH_MS / 60000);

  const line =
    status === "loading"
      ? "กำลังโหลดชุดข้อมูล…"
      : status === "error"
        ? "โหลดชุดข้อมูลไม่สำเร็จ — ตัวกรองจะใช้เซิร์ฟเวอร์"
        : syncedAtMs
          ? `กรองจากข้อมูลในเครื่อง · ซิงก์ ${timeFormat.format(new Date(syncedAtMs))}`
          : "กรองจากข้อมูลในเครื่อง";

  const Icon = status === "error" ? IconDatabaseOff : IconCloudDownload;

  return (
    <div className="mb-2 flex items-start gap-1.5 text-[10.5px] leading-tight text-ink-muted">
      <Icon
        size={12}
        stroke={1.8}
        className={`mt-px shrink-0 ${status === "error" ? "text-amber" : "text-ink-muted"}`}
      />
      <span className="min-w-0 flex-1">
        {line}
        {status !== "error" && (
          <span className="block text-ink-muted/70">อัปเดตอัตโนมัติทุก {minutes} นาที</span>
        )}
        {/* The reason belongs on screen, not only in the console — "it stopped
            updating" is unanswerable without it. */}
        {error && status === "error" && (
          <span className="block break-words text-amber/80">{error}</span>
        )}
      </span>
      <button
        type="button"
        onClick={refresh}
        disabled={status === "refreshing"}
        aria-label="ดึงข้อมูลใหม่"
        title="ดึงข้อมูลใหม่จากฐานข้อมูล"
        className="shrink-0 rounded border border-[rgba(56,100,150,0.5)] p-1 text-ink-muted hover:text-ink disabled:opacity-50"
      >
        <IconRefresh
          size={11}
          stroke={2}
          className={status === "refreshing" ? "animate-spin" : undefined}
        />
      </button>
    </div>
  );
}
