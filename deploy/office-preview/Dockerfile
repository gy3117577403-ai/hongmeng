# Pinned LibreOffice-only image; no public document viewer or external Office service.
FROM gotenberg/gotenberg:8.38.1-libreoffice@sha256:8df3b4afe2b0db4ee090caea2cf74c2ae9854c30a69d8de67a83d8e836a64126 AS configured
USER root
RUN test -n "$(fc-list :lang=zh family)" && fc-match 'Noto Sans CJK SC' && fc-match Carlito && fc-match Caladea

# A single layer makes both registries independently pullable and digest-identical.
FROM scratch
ARG APP_VERSION=v1.34.276
ARG APP_REVISION=local
COPY --from=configured / /
LABEL org.opencontainers.image.title="hongmeng-office-preview" \
      org.opencontainers.image.version=$APP_VERSION \
      org.opencontainers.image.revision=$APP_REVISION \
      org.opencontainers.image.source="https://github.com/gy3117577403-ai/hongmeng" \
      org.opencontainers.image.description="Gotenberg 8.38.1 LibreOffice with CJK fonts for private knowledge previews"
ENV HOME=/home/gotenberg \
    TMPDIR=/tmp \
    PATH=/opt/java/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    TZ=UTC LANG=C.UTF-8 LC_ALL=C.UTF-8 \
    PDFTK_BIN_PATH=/usr/bin/pdftk QPDF_BIN_PATH=/usr/bin/qpdf \
    EXIFTOOL_BIN_PATH=/usr/bin/exiftool PDFCPU_BIN_PATH=/usr/bin/pdfcpu \
    GOTENBERG_VERSIONS_DIR_PATH=/opt/gotenberg/versions \
    OTEL_TRACES_EXPORTER=none OTEL_METRICS_EXPORTER=none OTEL_LOGS_EXPORTER=none \
    LIBREOFFICE_BIN_PATH=/usr/lib/libreoffice/program/soffice.bin UNOCONVERTER_BIN_PATH=/usr/bin/unoconverter
USER gotenberg
WORKDIR /home/gotenberg
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["gotenberg", "--api-timeout=60s", "--api-body-limit=55MB", "--api-disable-download-from=true", "--webhook-disable=true", "--libreoffice-auto-start=true", "--libreoffice-max-queue-size=4", "--libreoffice-restart-after=10", "--libreoffice-deny-private-ips=true", "--libreoffice-deny-public-ips=true", "--libreoffice-deny-list=.*", "--pdfengines-disable-routes=true"]
