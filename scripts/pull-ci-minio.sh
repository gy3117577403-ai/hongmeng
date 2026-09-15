#!/usr/bin/env bash
set -euo pipefail

# This is the amd64 manifest referenced by the original pinned upstream index.
# Both registries must supply these exact bytes; no mutable release tag is used.
digest=sha256:a1a8bd4ac40ad7881a245bab97323e18f971e4d4cba2c2007ec1bedd21cbaba2
primary=${CI_MINIO_PRIMARY_IMAGE:-quay.io/minio/minio@$digest}
fallback=${CI_MINIO_FALLBACK_IMAGE:-crpi-2acb2dabuutklbx4.cn-hangzhou.personal.cr.aliyuncs.com/zhiju-b/hongmeng@$digest}
attempts=${CI_MINIO_PULL_ATTEMPTS:-2}
runtime=hongmeng-ci-minio:verified-a1a8bd4ac40a

for candidate in "$primary" "$fallback"; do
  [[ "$candidate" == *@"$digest" ]] || { echo 'Object-storage dependency must use the pinned digest' >&2; exit 1; }
  for ((attempt=1; attempt<=attempts; attempt++)); do
    if timeout 90s docker pull --platform linux/amd64 "$candidate"; then
      test "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$candidate")" = linux/amd64
      docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$candidate" | grep -Fq "@$digest"
      docker tag "$candidate" "$runtime"
      if [[ -n "${GITHUB_ENV:-}" ]]; then printf 'CI_MINIO_IMAGE=%s\n' "$runtime" >> "$GITHUB_ENV"; fi
      printf 'Verified object-storage dependency: %s\n' "$candidate"
      exit 0
    fi
    echo "Object-storage download attempt $attempt/$attempts failed: $candidate" >&2
    if (( attempt < attempts )); then sleep 5; fi
  done
done
echo 'Both pinned object-storage download sources failed' >&2
exit 1
