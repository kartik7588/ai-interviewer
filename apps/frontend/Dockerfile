FROM oven/bun:1.3.11
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
WORKDIR /app/apps/frontend
ARG BACKEND_URL
ENV BACKEND_URL=$BACKEND_URL
RUN bun run build.ts
EXPOSE 3000
CMD ["bun", "x", "serve", "dist", "-l", "3000"]
