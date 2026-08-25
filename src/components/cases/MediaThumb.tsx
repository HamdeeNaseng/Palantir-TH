"use client";

import { useState } from "react";
import { IconExternalLink, IconFileUnknown, IconPhotoOff } from "@tabler/icons-react";
import type { EventMedia } from "@/lib/types";

/**
 * One file the source attached to a record.
 *
 * The image is loaded straight from the source's own host — copying evidence
 * onto this origin would be a second, unversioned copy of material the raw
 * record already points at. `referrerPolicy="no-referrer"` keeps the analyst's
 * current case out of that host's logs.
 *
 * Client-side only for the error fallback: these are links into a government
 * file server that has been serving since 2004, and a dead one should read as
 * "the file is gone", not as a broken image icon.
 */
export default function MediaThumb({ item }: { item: EventMedia }) {
  const [failed, setFailed] = useState(false);
  const isImage = item.kind === "image";

  return (
    <figure className="overflow-hidden rounded border border-[rgba(37,66,102,0.6)] bg-[#0a1524]">
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer noopener"
        referrerPolicy="no-referrer"
        className="group block"
      >
        <div className="flex h-[104px] items-center justify-center bg-[#060d19]">
          {isImage && !failed ? (
            // Plain <img>: next/image would proxy these through this origin and
            // needs every source host listed in next.config, which is exactly
            // the coupling the raw-record pointer exists to avoid.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.url}
              alt={`หลักฐานแนบจากแหล่งข้อมูล (${item.field})`}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setFailed(true)}
              className="h-full w-full object-cover transition-opacity group-hover:opacity-80"
            />
          ) : (
            <span className="flex flex-col items-center gap-1 text-ink-muted">
              {isImage ? <IconPhotoOff size={20} stroke={1.5} /> : <IconFileUnknown size={20} stroke={1.5} />}
              <span className="text-[10px]">{isImage ? "โหลดไฟล์ไม่ได้" : "ไฟล์แนบ"}</span>
            </span>
          )}
        </div>

        <figcaption className="flex items-center justify-between gap-1 border-t border-[rgba(37,66,102,0.5)] px-2 py-1">
          <span className="truncate font-mono text-[10px] text-ink-muted" title={item.url}>
            {item.field}
          </span>
          <IconExternalLink size={11} stroke={1.8} className="shrink-0 text-ink-muted" />
        </figcaption>
      </a>
    </figure>
  );
}
