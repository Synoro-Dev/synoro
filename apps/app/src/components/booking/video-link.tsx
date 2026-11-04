"use client";

import { Button, Input, toast } from "@synoro/ui";
import { videoServiceName, videoUrlSchema } from "@synoro/validators";
import { VideoIcon } from "lucide-react";
import { useState } from "react";

import { SaveState } from "../settings/save-state";

/** «Войти на встречу» — opens the video room in a new tab. */
export function VideoLinkButton({
  url,
  size = "sm",
  variant = "default",
}: {
  url: string;
  size?: "sm" | "default";
  variant?: "default" | "outline";
}) {
  return (
    <Button
      size={size}
      variant={variant}
      nativeButton={false}
      render={<a href={url} target="_blank" rel="noreferrer noopener" />}
    >
      <VideoIcon />
      Войти на встречу
    </Button>
  );
}

/** «Толк» / «Телемост» / «Видеовстреча» for a link. */
export function VideoServiceName({ url }: { url: string }) {
  return <>{videoServiceName(url)}</>;
}

/**
 * One video-link field: shows the saved link and saves a new one (empty
 * clears it). The parent supplies what saving does and the surrounding words.
 */
export function VideoLinkForm({
  value,
  placeholder,
  pending,
  onSave,
  label,
  savedAt = null,
}: {
  value: string | null;
  placeholder: string;
  pending: boolean;
  onSave: (url: string) => void;
  label: string;
  /** Kept by the parent when a `key` remounts the form on saving. */
  savedAt?: number | null;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const dirty = draft.trim() !== (value ?? "");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = videoUrlSchema.safeParse(draft);
    if (!parsed.success) {
      toast.error(
        parsed.error.issues[0]?.message ?? "Проверьте ссылку на видеовстречу",
      );
      return;
    }
    onSave(draft);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          type="text"
          inputMode="url"
          aria-label={label}
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button type="submit" disabled={pending || !dirty}>
          Сохранить
        </Button>
      </div>
      <SaveState dirty={dirty} savedAt={savedAt} />
    </form>
  );
}
