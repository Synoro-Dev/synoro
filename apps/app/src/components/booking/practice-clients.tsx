"use client";

import type { RouterOutputs } from "@synoro/api";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Skeleton,
} from "@synoro/ui";
import { Badge } from "@synoro/ui/reui/badge";
import {
  DataGrid,
  type DataGridFeatures,
  dataGridFeatures,
} from "@synoro/ui/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@synoro/ui/reui/data-grid/data-grid-column-header";
import { DataGridPagination } from "@synoro/ui/reui/data-grid/data-grid-pagination";
import { DataGridScrollArea } from "@synoro/ui/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@synoro/ui/reui/data-grid/data-grid-table";
import { Frame, FrameFooter, FramePanel } from "@synoro/ui/reui/frame";
import { formatPhone } from "@synoro/validators";
import { useQuery } from "@tanstack/react-query";
import {
  type ColumnDef,
  type PaginationState,
  type SortingState,
  useTable,
} from "@tanstack/react-table";
import {
  ChevronRightIcon,
  SearchIcon,
  ShieldIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import { ROLE_LABELS } from "../sidebar/types";
import { ClientCard } from "./client-card";
import { AddMemberDialog, CreditDialog } from "./client-dialogs";
import { dataGridI18n } from "./data-grid-i18n";
import { EntryDialog, type EntryDraft } from "./entry-dialog";
import { EmptyState, ErrorState, PageHeading } from "./states";
import { useTerms } from "./terms";

export type Member = RouterOutputs["practice"]["members"][number];

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function nextHalfHour() {
  const at = new Date();
  at.setSeconds(0, 0);
  at.setMinutes(at.getMinutes() < 30 ? 30 : 60);
  return at;
}

function Balance({ credits }: { credits: number }) {
  return credits > 0 ? (
    <span className="font-medium tabular-nums">{credits}</span>
  ) : (
    <Badge variant="warning-light">0</Badge>
  );
}

function getColumns(
  onOpen: (member: Member) => void,
): ColumnDef<DataGridFeatures, Member>[] {
  return [
    {
      accessorKey: "name",
      id: "name",
      header: ({ column }) => (
        <DataGridColumnHeader title="Клиент" column={column} />
      ),
      cell: ({ row }) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="size-8">
            <AvatarImage src={row.original.image ?? undefined} alt="" />
            <AvatarFallback className="text-xs">
              {initials(row.original.name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{row.original.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {row.original.phone
                ? formatPhone(row.original.phone)
                : row.original.email}
            </span>
          </div>
        </div>
      ),
      size: 320,
    },
    {
      accessorKey: "credits",
      id: "credits",
      header: ({ column }) => (
        <DataGridColumnHeader title="На балансе" column={column} />
      ),
      cell: ({ row }) => <Balance credits={row.original.credits} />,
      size: 130,
    },
    {
      accessorKey: "joinedAt",
      id: "joinedAt",
      header: ({ column }) => (
        <DataGridColumnHeader title="Клиент с" column={column} />
      ),
      cell: ({ row }) => (
        <span className="text-muted-foreground tabular-nums">
          {row.original.joinedAt.toLocaleDateString("ru-RU")}
        </span>
      ),
      size: 120,
    },
    {
      id: "open",
      header: () => <span className="sr-only">Карточка</span>,
      // The row opens on click too; this button is the keyboard's way in.
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Открыть карточку: ${row.original.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onOpen(row.original);
            }}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      ),
      size: 48,
      enableSorting: false,
    },
  ];
}

/**
 * The practice's clients: search, balances, and a card per client with
 * booking and crediting. Phones get a list of rows, wide screens a table.
 * The team (owner, administrators) is listed apart, below.
 */
export function PracticeClients({
  practiceId,
  timezone,
  isOwner,
}: {
  practiceId: string;
  timezone: string;
  isOwner: boolean;
}) {
  const terms = useTerms();
  const members = useQuery(
    orpc.practice.members.queryOptions({ input: { practiceId } }),
  );
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  });
  // `?client=<id>` (from the ⌘K search) opens that client's card.
  const linked = useSearchParams().get("client");
  const [openId, setOpenId] = useState<string | null>(linked);
  const [seen, setSeen] = useState(linked);
  if (linked !== seen) {
    // Another client picked in ⌘K while this page is open.
    setSeen(linked);
    setOpenId(linked);
  }
  const [crediting, setCrediting] = useState<{
    member: Member;
    intent: "grant" | "adjust";
  } | null>(null);
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [adding, setAdding] = useState<"client" | "admin" | null>(null);

  const all = members.data ?? [];
  const clients = all.filter((m) => m.role === "client");
  const team = all.filter((m) => m.role !== "client");
  // The open card follows fresh data (a new balance after crediting).
  const open = clients.find((m) => m.id === openId) ?? null;

  const query = search.trim().toLowerCase();
  const digits = query.replace(/\D/g, "");
  const data = clients.filter(
    (m) =>
      !query ||
      m.name.toLowerCase().includes(query) ||
      m.email.toLowerCase().includes(query) ||
      (digits !== "" && (m.phone ?? "").includes(digits)),
  );

  const table = useTable({
    features: dataGridFeatures,
    data,
    columns: getColumns((member) => setOpenId(member.id)),
    state: { sorting, pagination },
    getRowId: (row) => row.id,
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Клиенты"
        description={`Контакты, записи и баланс оплаченных ${terms.credit[2]}`}
        actions={
          <Button onClick={() => setAdding("client")}>
            <UserPlusIcon />
            Пригласить клиента
          </Button>
        }
      />

      {members.isError ? (
        <ErrorState onRetry={() => members.refetch()} />
      ) : members.isPending ? (
        <div className="flex flex-col gap-2">
          {["a", "b", "c", "d"].map((k) => (
            <Skeleton key={k} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : clients.length === 0 ? (
        <Frame spacing="default">
          <FramePanel>
            <EmptyState
              icon={UsersIcon}
              title="Клиентов пока нет"
              description="Они появятся, когда запишутся по вашей ссылке. Или пригласите человека по почте."
              action={
                <Button onClick={() => setAdding("client")}>
                  <UserPlusIcon />
                  Пригласить клиента
                </Button>
              }
            />
          </FramePanel>
        </Frame>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <InputGroup className="h-11 max-w-sm md:h-9">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                placeholder="Имя, телефон или почта"
                aria-label="Поиск клиента"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPagination((p) => ({ ...p, pageIndex: 0 }));
                }}
              />
            </InputGroup>
            <span
              className="ml-auto text-sm whitespace-nowrap text-muted-foreground tabular-nums"
              aria-live="polite"
            >
              {query ? `Найдено: ${data.length}` : `Всего: ${clients.length}`}
            </span>
          </div>

          {/* Phones: one row per client, the whole row opens the card. */}
          <ul className="flex flex-col divide-y rounded-xl border bg-card md:hidden">
            {data.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                Никого не нашли
              </li>
            )}
            {data.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(m.id)}
                  className="flex min-h-16 w-full items-center gap-3 px-4 py-2 text-left outline-none focus-visible:bg-muted"
                >
                  <Avatar className="size-9">
                    <AvatarImage src={m.image ?? undefined} alt="" />
                    <AvatarFallback className="text-xs">
                      {initials(m.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">
                      {m.name}
                    </span>
                    <span className="truncate text-sm text-muted-foreground tabular-nums">
                      {m.phone ? formatPhone(m.phone) : m.email}
                    </span>
                  </span>
                  <Balance credits={m.credits} />
                  <ChevronRightIcon
                    className="size-4 text-muted-foreground"
                    aria-hidden
                  />
                </button>
              </li>
            ))}
          </ul>

          <div className="hidden md:block">
            <DataGrid
              table={table}
              recordCount={data.length}
              emptyMessage="Никого не нашли"
              i18n={dataGridI18n}
              onRowClick={(row: Member) => setOpenId(row.id)}
            >
              <Frame className="w-full" stacked dense>
                <FramePanel className="p-0 shadow-none">
                  <DataGridScrollArea>
                    <DataGridTable />
                  </DataGridScrollArea>
                </FramePanel>
                <FrameFooter className="flex-row flex-wrap items-center justify-end gap-2 py-1.5 pr-2 pl-2.5">
                  <DataGridPagination className="lg:w-auto" />
                </FrameFooter>
              </Frame>
            </DataGrid>
          </div>
        </div>
      )}

      {team.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="team">
          <h2 id="team" className="text-base font-medium">
            Команда
          </h2>
          <ul className="flex flex-col divide-y rounded-xl border bg-card">
            {team.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                <ShieldIcon
                  className="size-4 text-muted-foreground"
                  aria-hidden
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{m.name}</span>
                  <span className="truncate text-sm text-muted-foreground">
                    {m.email}
                  </span>
                </span>
                <Badge variant="outline">{ROLE_LABELS[m.role]}</Badge>
              </li>
            ))}
          </ul>
          {isOwner && (
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm text-muted-foreground">
                Администратор ведёт записи, балансы и рабочие часы. Аналитику,
                оплату и сообщения клиентам он не видит.
              </p>
              <Button variant="outline" onClick={() => setAdding("admin")}>
                <ShieldIcon />
                Пригласить администратора
              </Button>
            </div>
          )}
        </section>
      )}

      <ClientCard
        practiceId={practiceId}
        timezone={timezone}
        member={open}
        onClose={() => setOpenId(null)}
        onBook={(member) => {
          const start = nextHalfHour();
          setDraft({
            mode: "consultation",
            start,
            end: new Date(start.getTime() + 60 * 60_000),
            client: { id: member.id, name: member.name },
          });
        }}
        onCredit={(member, intent) => setCrediting({ member, intent })}
      />
      <CreditDialog
        practiceId={practiceId}
        member={crediting?.member ?? null}
        intent={crediting?.intent}
        onClose={() => setCrediting(null)}
      />
      <EntryDialog
        practiceId={practiceId}
        draft={draft}
        onClose={() => setDraft(null)}
      />
      <AddMemberDialog
        practiceId={practiceId}
        isOwner={isOwner}
        invite={adding ?? undefined}
        open={adding !== null}
        onClose={() => setAdding(null)}
      />
    </div>
  );
}
