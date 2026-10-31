"use client";

import { paths } from "@synoro/config";
import { Avatar, AvatarFallback, AvatarImage, Button, toast } from "@synoro/ui";
import { useQueryClient } from "@tanstack/react-query";
import { ImageUpIcon, Loader2Icon, Trash2Icon } from "lucide-react";
import { useRef, useState } from "react";

import { orpc } from "~/orpc/react";

const SIZE = 512;
const ACCEPT = ["image/jpeg", "image/png", "image/webp"];

/**
 * Center-crops the picked image to a square and re-encodes it as JPEG, so the
 * upload is small whatever the camera produced (and always the one format the
 * server accepts). Transparent PNGs get a white background.
 */
async function toSquareJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, SIZE, SIZE);
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    SIZE,
    SIZE,
  );
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Encode failed"))),
      "image/jpeg",
      0.9,
    );
  });
}

async function failure(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as {
    message?: string;
  } | null;
  return new Error(body?.message ?? fallback);
}

/**
 * The specialist's photo for the public booking page: click or drop a file to
 * upload, or remove it. The parent owns the current URL so a live preview can
 * follow it.
 */
export function PracticeAvatar({
  practiceId,
  name,
  imageUrl,
  onChange,
}: {
  practiceId: string;
  name: string;
  imageUrl: string | null;
  onChange: (imageUrl: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  // The ref blocks a second operation synchronously; `busy` mirrors it for UI.
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  /** One upload or removal at a time, from picking the file to the response. */
  async function exclusive(task: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      await task();
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  async function send(request: () => Promise<Response>, fallback: string) {
    try {
      const response = await request();
      if (!response.ok) throw await failure(response, fallback);
      const body = (await response.json()) as { imageUrl: string | null };
      onChange(body.imageUrl);
      await queryClient.invalidateQueries({ queryKey: orpc.practice.key() });
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : fallback);
      return false;
    }
  }

  async function upload(file: File) {
    // An empty type (dropped file without an extension) is decided by decoding.
    if (file.type && !ACCEPT.includes(file.type)) {
      toast.error("Нужен файл JPG, PNG или WebP");
      return;
    }
    await exclusive(async () => {
      let jpeg: Blob;
      try {
        jpeg = await toSquareJpeg(file);
      } catch {
        toast.error("Не удалось прочитать изображение");
        return;
      }
      const form = new FormData();
      form.set("file", jpeg, "avatar.jpg");
      const saved = await send(
        () =>
          fetch(paths.booking.avatarUpload(practiceId), {
            method: "POST",
            body: form,
          }),
        "Не удалось загрузить фото",
      );
      if (saved) toast.success("Фото обновлено");
    });
  }

  const pick = () => !busy && input.current?.click();

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <button
        type="button"
        onClick={pick}
        disabled={busy}
        aria-label={imageUrl ? "Заменить фото" : "Загрузить фото"}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file && !busy) void upload(file);
        }}
        className={`group relative size-36 shrink-0 cursor-pointer rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-wait ${
          dragging ? "ring-2 ring-primary ring-offset-2" : ""
        }`}
      >
        <Avatar className="size-36">
          {imageUrl && <AvatarImage src={imageUrl} alt={name} />}
          <AvatarFallback className="text-4xl font-medium">
            {name.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span
          className={`absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-full bg-background/80 text-xs font-medium backdrop-blur-[1px] transition-opacity ${
            busy || dragging
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
          }`}
        >
          {busy ? (
            <Loader2Icon className="size-5 animate-spin" />
          ) : (
            <ImageUpIcon className="size-5" />
          )}
          {busy ? "Загружаем…" : dragging ? "Отпустите файл" : "Выбрать фото"}
        </span>
      </button>

      <div className="flex min-w-0 flex-col items-start gap-3">
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={pick}>
            <ImageUpIcon />
            {imageUrl ? "Заменить фото" : "Загрузить фото"}
          </Button>
          {imageUrl && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                exclusive(async () => {
                  await send(
                    () =>
                      fetch(paths.booking.avatarUpload(practiceId), {
                        method: "DELETE",
                      }),
                    "Не удалось удалить фото",
                  );
                })
              }
            >
              <Trash2Icon />
              Удалить
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Нажмите на круг или перетащите файл. Подойдёт квадратное фото: JPG,
          PNG или WebP — лишнее по краям мы обрежем сами.
        </p>
      </div>

      <input
        ref={input}
        type="file"
        accept={ACCEPT.join(",")}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Allow picking the same file again after a failed attempt.
          event.target.value = "";
          if (file) void upload(file);
        }}
      />
    </div>
  );
}
