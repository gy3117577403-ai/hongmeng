# v1.34.87 国内镜像验收记录

- Release tag: `v1.34.87`
- Source commit: `411abffe85da069fe6785ae7484490a6c6d255ed`
- GitHub Actions run: `33485949513` (`success`)
- Immutable manifest digest: `sha256:7dbfdd74404328a305708c8df83c7d87d635ac048af67a9e6a64bafaf237452e`
- Effective content layers: 1 x `180555696` bytes
- Metadata-only layer: 1 x `32` bytes

## Domestic anonymous pull

Verified with a newly created Docker client configuration containing no registry credentials:

```text
ghcr.linkos.org/gy3117577403-ai/hongmeng@sha256:7dbfdd74404328a305708c8df83c7d87d635ac048af67a9e6a64bafaf237452e
```

Docker completed the effective content layer, reported the expected immutable digest, and returned `Downloaded newer image`.

The NJU mirror also resolved and completed the same immutable digest:

```text
ghcr.nju.edu.cn/gy3117577403-ai/hongmeng@sha256:7dbfdd74404328a305708c8df83c7d87d635ac048af67a9e6a64bafaf237452e
```

## Exact pulled-image runtime smoke

The exact LinkOS domestic reference above was started as `hm-cn-mirror-v13487` and connected only to the isolated WIP acceptance PostgreSQL database. Health response:

```json
{"ok":true,"service":"hongmeng-workorder-resource","app":{"name":"杭连协同平台","version":"v1.34.87","revision":"411abffe85da069fe6785ae7484490a6c6d255ed"}}
```

Production Sealos and the production database were not changed.
