"use client";

import type { RouterOutputs } from "@acme/api";
import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@acme/ui";
import { Alert, AlertDescription, AlertTitle } from "@acme/ui/reui/alert";
import { Badge } from "@acme/ui/reui/badge";
import {
  DataGrid,
  type DataGridFeatures,
  dataGridFeatures,
} from "@acme/ui/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@acme/ui/reui/data-grid/data-grid-column-header";
import { DataGridPagination } from "@acme/ui/reui/data-grid/data-grid-pagination";
import { DataGridScrollArea } from "@acme/ui/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@acme/ui/reui/data-grid/data-grid-table";
import { Frame, FrameFooter, FramePanel } from "@acme/ui/reui/frame";
import { useQuery } from "@tanstack/react-query";
import {
  type ColumnDef,
  type PaginationState,
  type SortingState,
  useTable,
} from "@tanstack/react-table";
import {
  EllipsisIcon,
  HistoryIcon,
  SearchIcon,
  UserPlusIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import { ROLE_LABELS } from "../sidebar/types";
import { AddMemberDialog, CreditDialog, HistorySheet } from "./client-dialogs";
import { dataGridI18n } from "./data-grid-i18n";
import { ErrorState, PageHeading } from "./states";

export type Member = RouterOutputs["practice"]["members"][number];

const ROLE_BADGE = {
  owner: "primary-light",
  admin: "info-light",
  client: "outline",
} as const;

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function getColumns(actions: {
  onCredit: (m: Member) => void;
  onHistory: (m: Member) => void;
}): ColumnDef<DataGridFeatures, Member>[] {
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
            <AvatarFallback className="text-xs">
              {initials(row.original.name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{row.original.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {row.original.email}
            </span>
          </div>
        </div>
      ),
      size: 260,
    },
    {
      accessorKey: "role",
      id: "role",
      header: ({ column }) => (
        <DataGridColumnHeader title="Роль" column={column} />
      ),
      cell: ({ row }) => (
        <Badge variant={ROLE_BADGE[row.original.role]}>
          {ROLE_LABELS[row.original.role]}
        </Badge>
      ),
      size: 140,
    },
    {
      accessorKey: "credits",
      id: "credits",
      header: ({ column }) => (
        <DataGridColumnHeader title="Оплачено" column={column} />
      ),
      cell: ({ row }) =>
        row.original.role === "client" ? (
          <div className="flex items-center gap-2">
            {row.original.credits > 0 ? (
              <span className="w-6 font-medium tabular-nums">
                {row.original.credits}
              </span>
            ) : (
              <Badge variant="warning-light">0</Badge>
            )}
            <Button
              size="xs"
              variant="outline"
              onClick={() => actions.onCredit(row.original)}
            >
              <WalletIcon />
              Изменить
            </Button>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
      size: 170,
    },
    {
      accessorKey: "joinedAt",
      id: "joinedAt",
      header: ({ column }) => (
        <DataGridColumnHeader title="С нами с" column={column} />
      ),
      cell: ({ row }) => (
        <span className="text-muted-foreground tabular-nums">
          {row.original.joinedAt.toLocaleDateString("ru-RU")}
        </span>
      ),
      size: 110,
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Действия</span>,
      cell: ({ row }) =>
        row.original.role === "client" ? (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button size="icon-sm" variant="ghost" aria-label="Ещё" />
                }
              >
                <EllipsisIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => actions.onCredit(row.original)}
                >
                  <WalletIcon />
                  Изменить баланс
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => actions.onHistory(row.original)}
                >
                  <HistoryIcon />
                  История баланса
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null,
      size: 56,
      enableSorting: false,
    },
  ];
}

/** Members of a practice: balances, crediting paid consultations, history. */
export function PracticeClients({
  practiceId,
  isOwner,
}: {
  practiceId: string;
  isOwner: boolean;
}) {
  const members = useQuery(
    orpc.practice.members.queryOptions({ input: { practiceId } }),
  );
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  });
  const [crediting, setCrediting] = useState<Member | null>(null);
  const [history, setHistory] = useState<Member | null>(null);
  const [adding, setAdding] = useState(false);

  const query = search.trim().toLowerCase();
  const data = (members.data ?? []).filter(
    (m) =>
      !query ||
      m.name.toLowerCase().includes(query) ||
      m.email.toLowerCase().includes(query),
  );
  const columns = getColumns({ onCredit: setCrediting, onHistory: setHistory });

  const table = useTable({
    features: dataGridFeatures,
    data,
    columns,
    state: { sorting, pagination },
    getRowId: (row) => row.id,
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
  });

  const clientCount = (members.data ?? []).filter(
    (m) => m.role === "client",
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Клиенты"
        description="Баланс оплаченных консультаций и команда практики"
        actions={
          <Button size="sm" onClick={() => setAdding(true)}>
            <UserPlusIcon />
            Пригласить
          </Button>
        }
      />

      {members.isError ? (
        <ErrorState onRetry={() => members.refetch()} />
      ) : !members.isPending && clientCount === 0 && !query ? (
        <Alert variant="info">
          <UsersIcon />
          <AlertTitle>Клиентов пока нет</AlertTitle>
          <AlertDescription>
            Они появятся, когда откроют вашу ссылку для записи. Или пригласите
            человека по почте.
          </AlertDescription>
        </Alert>
      ) : null}

      {!members.isError && (
        <DataGrid
          table={table}
          recordCount={data.length}
          isLoading={members.isPending}
          emptyMessage="Никого не нашли"
          i18n={dataGridI18n}
        >
          <Frame className="w-full" stacked dense>
            <FramePanel className="flex items-center gap-2 py-2">
              <InputGroup className="max-w-xs">
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput
                  placeholder="Имя или почта"
                  aria-label="Поиск"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPagination((p) => ({ ...p, pageIndex: 0 }));
                  }}
                />
              </InputGroup>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {data.length} из {members.data?.length ?? 0}
              </span>
            </FramePanel>
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
      )}

      <CreditDialog
        practiceId={practiceId}
        member={crediting}
        onClose={() => setCrediting(null)}
      />
      <HistorySheet member={history} onClose={() => setHistory(null)} />
      <AddMemberDialog
        practiceId={practiceId}
        isOwner={isOwner}
        open={adding}
        onClose={() => setAdding(false)}
      />
    </div>
  );
}
