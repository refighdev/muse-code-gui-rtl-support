import { FileTextIcon, PaperclipIcon, XIcon } from "../ui/icons.js";
import { useEffect, useState } from "react";
import type { AttachmentView, OutgoingAttachment } from "../../types.js";
import type { EchoAttachment } from "../../model/fold.js";
import { cn } from "../ui/primitives.js";

/** A file the user attached but has not sent yet: bytes ready for the wire, plus a local preview. */
export interface PendingFile {
  id: string;
  name: string;
  mediaType: string;
  kind: "image" | "file";
  /** An object URL for an image preview; null for anything else. */
  url: string | null;
  base64: string;
  width?: number;
  height?: number;
  size: number;
}

/** Images are the one part Muse takes directly; everything else rides along as a file in the workspace. */
export function kindOf(mediaType: string): "image" | "file" {
  return mediaType.startsWith("image/") ? "image" : "file";
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function measure(url: string): Promise<{ width: number; height: number } | null> {
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image.naturalWidth > 0 ? { width: image.naturalWidth, height: image.naturalHeight } : null;
  } catch {
    return null;
  }
}

let fileSeq = 0;

/** Reads dropped, pasted or picked files into what the composer holds until the message is sent. */
export async function readFiles(files: Iterable<File>): Promise<PendingFile[]> {
  const out: PendingFile[] = [];
  for (const file of files) {
    const mediaType = file.type || "application/octet-stream";
    const kind = kindOf(mediaType);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const url = kind === "image" ? URL.createObjectURL(file) : null;
    const size = url ? await measure(url) : null;
    fileSeq += 1;
    out.push({
      id: `file-${Date.now().toString(36)}-${fileSeq}`,
      name: file.name || (kind === "image" ? "pasted-image.png" : "file"),
      mediaType,
      kind,
      url,
      base64: toBase64(bytes),
      ...(size ?? {}),
      size: bytes.length,
    });
  }
  return out;
}

/**
 * Reads a sent turn's files back from the server, so a retry carries the same bytes rather than
 * quietly asking the model a different question. Throws when a file cannot be read.
 */
export async function refetchAttachments(files: readonly AttachmentView[]): Promise<PendingFile[]> {
  const out: PendingFile[] = [];
  for (const file of files) {
    const response = await fetch(file.url);
    if (!response.ok) {
      throw new Error(`${file.name} could not be read back (${response.status}).`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    fileSeq += 1;
    out.push({
      id: `file-${Date.now().toString(36)}-${fileSeq}`,
      name: file.name,
      mediaType: file.mediaType,
      kind: file.kind,
      // The server keeps serving these, so the preview needs no object URL of its own.
      url: file.kind === "image" ? file.url : null,
      base64: toBase64(bytes),
      ...(file.width !== null && file.height !== null ? { width: file.width, height: file.height } : {}),
      size: bytes.length,
    });
  }
  return out;
}

export function toOutgoing(file: PendingFile): OutgoingAttachment {
  return {
    name: file.name,
    mediaType: file.mediaType,
    base64: file.base64,
    ...(file.width !== undefined && file.height !== undefined ? { width: file.width, height: file.height } : {}),
  };
}

/**
 * Rebuilds the tray from a prompt handed back after a failed send. The bytes are already in hand, so
 * nothing is read a second time, and the previews the message went out with still resolve.
 */
export function restoreFiles(attachments: readonly OutgoingAttachment[], previews: readonly EchoAttachment[]): PendingFile[] {
  return attachments.map((file, index) => {
    const preview = previews[index];
    const padding = file.base64.endsWith("==") ? 2 : file.base64.endsWith("=") ? 1 : 0;
    fileSeq += 1;
    return {
      id: `file-${Date.now().toString(36)}-${fileSeq}`,
      name: file.name,
      mediaType: file.mediaType,
      kind: preview?.kind ?? kindOf(file.mediaType),
      url: preview?.url ?? null,
      base64: file.base64,
      ...(file.width !== undefined && file.height !== undefined ? { width: file.width, height: file.height } : {}),
      // Four base64 characters carry three bytes, less whatever the padding stands in for.
      size: Math.max(0, Math.floor((file.base64.length * 3) / 4) - padding),
    };
  });
}

export function toPreview(file: PendingFile): EchoAttachment {
  return { name: file.name, mediaType: file.mediaType, kind: file.kind, url: file.url };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** What the composer shows for the files waiting to go with the next message. */
export function AttachmentTray(props: { files: PendingFile[]; onRemove: (id: string) => void }) {
  const [zoom, setZoom] = useState<PendingFile | null>(null);
  if (props.files.length === 0) {
    return null;
  }
  return (
    <>
      <ul className="flex flex-wrap gap-2 px-3 pt-3">
        {props.files.map((file) => (
          <li key={file.id} className="group/att relative">
            {file.kind === "image" && file.url ? (
              <button
                type="button"
                onClick={() => setZoom(file)}
                aria-label={`Open ${file.name}`}
                className="block size-16 overflow-hidden rounded-xl bg-sunken shadow-[0_0_0_1px_var(--border)] transition-transform duration-150 ease-out active:scale-[0.97]"
              >
                <img src={file.url} alt={file.name} className="size-full object-cover" />
              </button>
            ) : (
              <div className="flex h-16 max-w-[220px] items-center gap-2 rounded-xl bg-sunken px-3 shadow-[0_0_0_1px_var(--border)]">
                <FileTextIcon size={15} className="shrink-0 text-subtle" />
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-fg">{file.name}</p>
                  <p className="text-2xs text-subtle">{formatSize(file.size)}</p>
                </div>
              </div>
            )}
            <button
              type="button"
              aria-label={`Remove ${file.name}`}
              onClick={() => props.onRemove(file.id)}
              className="absolute -top-1.5 -right-1.5 inline-flex size-5 items-center justify-center rounded-full bg-inverse text-inverse-fg opacity-0 shadow-pop transition-opacity duration-100 group-hover/att:opacity-100 focus-visible:opacity-100"
            >
              <XIcon size={11} />
            </button>
          </li>
        ))}
      </ul>
      {zoom?.url ? <Lightbox name={zoom.name} url={zoom.url} onClose={() => setZoom(null)} /> : null}
    </>
  );
}

/** The sent message's copy of its attachments, served back by the server. */
export function SentAttachments(props: { files: (AttachmentView | EchoAttachment)[]; className?: string }) {
  const [zoom, setZoom] = useState<{ name: string; url: string } | null>(null);
  if (props.files.length === 0) {
    return null;
  }
  return (
    <>
      <ul className={cn("flex flex-wrap justify-end gap-2", props.className)}>
        {props.files.map((file, index) => (
          <li key={"id" in file ? file.id : `${file.name}-${index}`}>
            {file.kind === "image" && file.url ? (
              <button
                type="button"
                onClick={() => setZoom({ name: file.name, url: file.url as string })}
                aria-label={`Open ${file.name}`}
                className="block max-h-44 overflow-hidden rounded-xl bg-sunken shadow-[0_0_0_1px_var(--border)] transition-transform duration-150 ease-out active:scale-[0.98]"
              >
                <img src={file.url} alt={file.name} className="max-h-44 w-auto object-contain" />
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-sunken px-2.5 py-1.5 text-xs text-muted shadow-[0_0_0_1px_var(--border)]">
                <FileTextIcon size={13} className="shrink-0 text-subtle" />
                {file.name}
              </span>
            )}
          </li>
        ))}
      </ul>
      {zoom ? <Lightbox name={zoom.name} url={zoom.url} onClose={() => setZoom(null)} /> : null}
    </>
  );
}

/** An image at full size over the thread; Escape or a click anywhere closes it. */
function Lightbox(props: { name: string; url: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        props.onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [props]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={props.name}
      onClick={props.onClose}
      className="overlay-fade fixed inset-0 z-50 flex items-center justify-center bg-[oklch(0_0_0/0.62)] p-8"
    >
      <img src={props.url} alt={props.name} className="modal-pop max-h-full max-w-full rounded-xl object-contain shadow-pop" />
    </div>
  );
}

/** The button that opens the file picker. */
export function AttachButton(props: { onFiles: (files: FileList) => void; disabled?: boolean }) {
  return (
    <label
      className={cn(
        "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors duration-100 hover:bg-hover hover:text-fg",
        props.disabled && "pointer-events-none opacity-50",
      )}
    >
      <span className="sr-only">Attach files</span>
      <PaperclipIcon size={14} />
      <input
        type="file"
        multiple
        className="hidden"
        disabled={props.disabled}
        onChange={(event) => {
          if (event.currentTarget.files?.length) {
            props.onFiles(event.currentTarget.files);
          }
          event.currentTarget.value = "";
        }}
      />
    </label>
  );
}
