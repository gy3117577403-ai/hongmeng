#!/bin/bash
set -euo pipefail
upstream=$1
mirror=$2
revision=$3
digest=$(timeout 30s docker buildx imagetools inspect "$upstream" | awk '$1 == "Digest:" { print $2; exit }')
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]
pulled=0
for attempt in $(seq 1 30); do
  if timeout 240s docker pull "$mirror"; then pulled=1; break; fi
  echo "Waiting for Hangzhou Office converter ($attempt/30)"
  sleep 20
done
test "$pulled" = 1
docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$mirror" | grep -F "${mirror%:*}@$digest"
test "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$mirror")" = linux/amd64
test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$mirror")" = "$revision"
