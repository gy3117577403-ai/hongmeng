FROM node:20-alpine AS base
ARG APP_VERSION=v1.34.115
ARG APP_REVISION=local
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 APP_VERSION=$APP_VERSION APP_REVISION=$APP_REVISION
RUN apk add --no-cache openssl

FROM base AS builder
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN NODE_OPTIONS=--max-old-space-size=4096 npm run build
RUN cp -r .next/static .next/standalone/.next/static && if [ -d public ]; then cp -r public .next/standalone/public; fi
RUN node -e "const fs = require('node:fs'); fs.writeFileSync('.next/standalone/.release-image.json', JSON.stringify({ version: process.env.APP_VERSION, revision: process.env.APP_REVISION }) + '\\n')"

FROM base AS runner
ARG APP_VERSION=v1.34.115
ARG APP_REVISION=local
LABEL org.opencontainers.image.title="hongmeng-workorder-resource" \
      org.opencontainers.image.version=$APP_VERSION \
      org.opencontainers.image.revision=$APP_REVISION \
      org.opencontainers.image.source="https://github.com/gy3117577403-ai/hongmeng"
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 DAILY_PLAN_ENABLED=true
COPY --from=builder /app/.next/standalone ./.next/standalone
COPY --from=builder /app/.next/static ./.next/standalone/.next/static
COPY --from=builder /app/public ./.next/standalone/public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/bcryptjs ./node_modules/bcryptjs
COPY --from=builder /app/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs ./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs
COPY --from=builder /app/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs ./node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs
COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh
COPY --from=builder /app/scripts/validate-runtime-env.mjs ./scripts/validate-runtime-env.mjs
RUN sed -i 's/\r$//' docker-entrypoint.sh && chmod +x docker-entrypoint.sh
EXPOSE 3000
CMD ["./docker-entrypoint.sh"]

# Public pull-through registries are much more reliable when the final image has
# one content layer instead of many independent application COPY layers. Preserve
# the verified runner filesystem, then re-declare the OCI runtime configuration.
FROM scratch AS final
ARG APP_VERSION=v1.34.115
ARG APP_REVISION=local
LABEL org.opencontainers.image.title="hongmeng-workorder-resource" \
      org.opencontainers.image.version=$APP_VERSION \
      org.opencontainers.image.revision=$APP_REVISION \
      org.opencontainers.image.source="https://github.com/gy3117577403-ai/hongmeng"
ENV NEXT_TELEMETRY_DISABLED=1 \
    APP_VERSION=$APP_VERSION \
    APP_REVISION=$APP_REVISION \
    NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DAILY_PLAN_ENABLED=true
COPY --from=runner / /
WORKDIR /app
EXPOSE 3000
CMD ["./docker-entrypoint.sh"]
