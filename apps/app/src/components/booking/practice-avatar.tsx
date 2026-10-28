"use client";

import { paths } from "@synoro/config";
import { Avatar, AvatarFallback, AvatarImage, Button, toast } from "@synoro/ui";
import { useQueryClient } from "@tanstack/react-query";
import { ImageUpIcon, Trash2Icon } from "lucide-react";
import { useRef, useState } from "react";

import { orpc } from "~/orpc/react";

const SIZE = 512;

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

/** The specialist's photo for the public booking page: upload or remove. */
export function PracticeAvatar({
  practiceId,
  name,
  imageUrl,
}: {
  practiceId: string;
  name: string;
  imageUrl: string | null;
}) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(imageUrl);
  const [busy, setBusy] = useState(false);

  async function send(request: () => Promise<Response>, fallback: string) {
    setBusy(true);
    try {
      const response = await request();
      if (!response.ok) throw await failure(response, fallback);
      const body = (await response.json()) as { imageUrl: string | null };
      setUrl(body.imageUrl);
      await queryClient.invalidateQueries({ queryKey: orpc.practice.key() });
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : fallback);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
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
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar className="size-16">
        {url && <AvatarImage src={url} alt={name} />}
        <AvatarFallback className="text-lg font-medium">
          {name.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-col items-start gap-2">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <ImageUpIcon />
            {url ? "Заменить фото" : "Загрузить фото"}
          </Button>
          {url && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                send(
                  () =>
                    fetch(paths.booking.avatarUpload(practiceId), {
                      method: "DELETE",
                    }),
                  "Не удалось удалить фото",
                )
              }
            >
              <Trash2Icon />
              Удалить
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Квадратное фото лучше всего: JPG, PNG или WebP.
        </p>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
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
