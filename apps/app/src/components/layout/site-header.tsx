"use client";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Separator,
  SidebarTrigger,
} from "@synoro/ui";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

interface SiteHeaderProps {
  title: string;
  /** Breadcrumb before the title, e.g. the practice name. */
  parent?: { label: string; href: string };
  /** Page actions, right-aligned. */
  actions?: ReactNode;
}

export function SiteHeader({ title, parent, actions }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 lg:px-6">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="my-auto mr-1 h-4" />
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap">
          {parent && (
            <>
              <BreadcrumbItem className="hidden min-w-0 md:block">
                <BreadcrumbLink
                  className="truncate"
                  render={<Link href={parent.href as Route} />}
                >
                  {parent.label}
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
            </>
          )}
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage className="truncate">{title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </header>
  );
}
