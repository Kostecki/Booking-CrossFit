# One image for both services: the web app (default command) and the worker.
FROM node:25.8.1-bookworm-slim AS base
WORKDIR /app

# Full install (better-sqlite3 may need to compile) and the web build.
FROM base AS build
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 make g++ \
	&& rm -rf /var/lib/apt/lists/* \
	&& npm install -g pnpm@10.33.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY packages/core packages/core
COPY apps/web apps/web
# The commit being built, shown in the app's settings
ARG COMMIT_SHA=dev
ENV COMMIT_SHA=$COMMIT_SHA
RUN pnpm --filter @booking/web build \
	&& CI=true pnpm install --frozen-lockfile --prod

FROM base AS runtime
# DEP0169: web-push (latest, 3.6.7) still calls url.parse() on push endpoints; harmless,
# so that one warning is silenced and all others still show.
ENV NODE_ENV=production \
	NODE_OPTIONS=--disable-warning=DEP0169 \
	PORT=3000 \
	DATA_DIR=/data \
	MIGRATIONS_DIR=/app/apps/web/drizzle
# Named volumes inherit this ownership; a bind mount's host folder must be chowned to
# 1000:1000 (the "node" user) by hand.
RUN mkdir /data && chown node:node /data
# Keep the workspace layout: the worker runs from TypeScript source (Node strips types,
# but not under node_modules), and the server resolves better-sqlite3 from apps/web.
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/core packages/core
COPY --from=build /app/apps/web/node_modules apps/web/node_modules
COPY --from=build /app/apps/web/.output apps/web/.output
COPY apps/web/package.json apps/web/
COPY apps/web/drizzle apps/web/drizzle
COPY apps/web/src apps/web/src
WORKDIR /app/apps/web
USER node
VOLUME /data
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
