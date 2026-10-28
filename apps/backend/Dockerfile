FROM oven/bun:1.3.11
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile && cd apps/backend && bunx prisma generate
WORKDIR /app/apps/backend
ENV NODE_ENV=production
EXPOSE 3001
CMD ["bun", "run", "index.ts"]
