"use client";

import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@acme/ui";
import { Alert, AlertDescription, AlertTitle } from "@acme/ui/reui/alert";
import { IconStack } from "@acme/ui/reui/icon-stack";
import { CircleAlertIcon, type LucideIcon, RotateCcwIcon } from "lucide-react";
import type { ReactNode } from "react";

/** A no-data message with isometric art and at most one action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia>
          <IconStack aria-hidden="true" className="w-16">
            <Icon className="size-4" />
          </IconStack>
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

/** Inline load failure for one data region, with Retry. */
export function ErrorState({
  message,
  onRetry,
}: {
  message?: string;
  onRetry: () => void;
}) {
  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>Не удалось загрузить</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-2">
        <span>{message ?? "Проверьте соединение и попробуйте ещё раз."}</span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCcwIcon />
          Повторить
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** Page title row: title + one-clause description left, actions right. */
export function PageHeading({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
