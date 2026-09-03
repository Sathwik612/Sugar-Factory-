FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY artifacts/sugar-factory-dashboard ./artifacts/sugar-factory-dashboard
COPY lib ./lib
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workspace/sugar-factory-dashboard run build

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/artifacts/sugar-factory-dashboard/dist/public /usr/share/nginx/html
EXPOSE 80