# Production deployment

Use three managed services: a static frontend, a Bun backend, and managed PostgreSQL.

## Railway quick path

1. Push this repository to a private GitHub repository. Do not commit `.env` files.
2. Create a Railway project and add a PostgreSQL service.
3. Add a backend service from this repository. Set its root directory to `apps/backend`, or use the included backend Dockerfile with repository root as the Docker build context.
4. Set these backend variables:
   - `DATABASE_URL`: Railway PostgreSQL connection URL
   - `GEMINI_API_KEY`: a restricted Gemini API key
   - `FRONTEND_URL`: the deployed frontend URL, for example `https://interview.example.com`
   - `PORT`: supplied automatically by Railway
   - `NODE_ENV=production`
5. Run `bunx prisma db push` once against the managed database before the first backend release. Use migrations rather than `db push` for a team production workflow.
6. Create a frontend service or static site from `apps/frontend`. Build with `BACKEND_URL=https://your-api-domain` and serve the `dist` directory.
7. Set the same `FRONTEND_URL` backend variable to the final frontend domain and redeploy the backend.

## Safety checklist

- Restrict `GEMINI_API_KEY` to the Gemini API; never place it in frontend code.
- Set a Gemini monthly spend cap and billing alerts.
- Use a managed PostgreSQL backup policy.
- Set `FRONTEND_URL` to the exact production origin; it is enforced by CORS.
- Watch JSON request logs by `X-Request-Id` in your host dashboard.
- The included in-memory request limit protects a single backend instance. For multi-instance production traffic, move rate limiting and sessions to Redis.
- Replace the current in-memory auth sessions with signed persistent sessions or JWT before a multi-instance deployment.
