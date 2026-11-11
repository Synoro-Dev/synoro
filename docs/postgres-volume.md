# Preserve an existing Postgres 18 cluster

The Postgres 18 image uses `PGDATA=/var/lib/postgresql/18/docker`. The named
`postgres` volume is mounted at `/var/lib/postgresql`, so it contains
`18/docker/PG_VERSION` and the rest of the cluster.

If the existing container was created with the old mount at
`/var/lib/postgresql/data`, the actual cluster may be in an anonymous volume.
Before the first `docker compose up` with the corrected mount, copy the cluster
from the **existing container** using the procedure below. The old named volume
is not a backup of that cluster. Do not use `docker compose down`, remove the
container, or prune volumes before completing and checking the backup.

Run from the repository root, with Bash, Docker Compose and Node available.
Stop application processes that write to the database first. These commands
assume the existing container is named `postgres`, as in the Compose file.
The backup contains database data; keep it private and outside the checkout.

```bash
set -euo pipefail
umask 077
backup_dir="$(mktemp -d "$HOME/postgres18-backup.XXXXXX")"

# A physical copy must be taken after a clean shutdown.
docker stop --time 120 postgres
test "$(docker inspect -f '{{.State.Status}}:{{.State.ExitCode}}' postgres)" = 'exited:0'
docker cp postgres:/var/lib/postgresql/18/docker - > "$backup_dir/cluster.tar"
test "$(tar -xOf "$backup_dir/cluster.tar" docker/PG_VERSION)" = '18'

# Resolve the actual volume name (including the Compose project prefix).
postgres_volume="$(docker compose config --format json | node -e '
let input = "";
for await (const chunk of process.stdin) input += chunk;
const name = JSON.parse(input).volumes.postgres.name;
if (!name) throw new Error("Cannot resolve the postgres volume");
process.stdout.write(name);
')"
docker volume create "$postgres_volume"

# One-time restore: refuse to overwrite any existing volume contents.
# The image must match the old cluster's major version and architecture.
docker run --rm --network none --entrypoint sh \
  --mount "type=volume,src=$postgres_volume,dst=/target" \
  --mount "type=bind,src=$backup_dir,dst=/backup,readonly" \
  postgres:18-alpine -eu -c '
    test -z "$(ls -A /target)" || {
      echo "Target volume is not empty; inspect it before proceeding" >&2
      exit 1
    }
    mkdir -p /target/18
    tar -xpf /backup/cluster.tar -C /target/18
    test "$(cat /target/18/docker/PG_VERSION)" = 18
  '

# Only now recreate the service. Keep the backup until data is checked.
docker compose up -d --wait postgres
docker compose exec -T postgres psql -U postgres -d acme -c '\dt'
```

Check application records and expected table counts before resuming writes.
If the target is nonempty, stop and inspect it; do not delete its contents or
repeat the restore into it. A partially failed restore also needs inspection.
The stopped old container can be restarted before recreation if recovery is
needed. After recreation, keep the archive for recovery into a separate empty
volume. Fresh installations and containers already using the corrected mount
do not need this transfer.
