FROM node:20-alpine AS builder
ARG APP_VERSION=v1.17.0
ARG APP_REVISION=local
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 APP_VERSION=$APP_VERSION APP_REVISION=$APP_REVISION
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build
RUN cp -r .next/static .next/standalone/.next/static && if [ -d public ]; then cp -r public .next/standalone/public; fi
FROM node:20-alpine AS runner
ARG APP_VERSION=v1.17.0
ARG APP_REVISION=local
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 APP_VERSION=$APP_VERSION APP_REVISION=$APP_REVISION
RUN apk add --no-cache openssl
COPY --from=builder /app ./
RUN sed -i 's/\r$//' docker-entrypoint.sh && chmod +x docker-entrypoint.sh
EXPOSE 3000
CMD ["./docker-entrypoint.sh"]
