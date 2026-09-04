FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY artifacts/sugar-factory-dashboard ./artifacts/sugar-factory-dashboard
COPY lib ./lib
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workspace/sugar-factory-dashboard run build

FROM nginx:1.27-alpine
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/artifacts/sugar-factory-dashboard/dist/public /usr/share/nginx/html
COPY docker/web-entrypoint.sh /usr/local/bin/web-entrypoint.sh
RUN chmod 755 /usr/local/bin/web-entrypoint.sh
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-80}/" || exit 1
EXPOSE 80
ENTRYPOINT ["/usr/local/bin/web-entrypoint.sh"]