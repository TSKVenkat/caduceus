FROM node:22-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:22-alpine

RUN apk add --no-cache \
    tini \
    ripgrep \
    git \
    openssh-client \
    bash \
    su-exec

RUN adduser -D -u 10000 caduceus

ENV NODE_ENV=production
ENV CADUCEUS_HOME=/opt/data

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

VOLUME ["/opt/data"]

ENTRYPOINT ["/sbin/tini", "-g", "--", "/entrypoint.sh"]

CMD ["node", "./dist/cli.js"]
