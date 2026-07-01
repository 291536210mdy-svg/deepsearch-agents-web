# Deploying DeepSearch Agents as a Web App

This repository is a teaching project, so the local developer workflow uses
PowerShell, Docker, `uv`, and `pnpm`. For non-technical users, deploy it as a
web app:

- Frontend: Vercel
- Backend: Render, Railway, Fly.io, or another container host with WebSocket support
- Database: managed MySQL for the current code, or migrate to Supabase Postgres later

Vercel is a good frontend host, but this backend should not be deployed as
Vercel Functions because the app uses FastAPI WebSocket connections and
background agent tasks.

## Recommended Path

- Backend: Railway
- Database: Railway MySQL
- Frontend: Vercel

Railway is used for the long-running FastAPI service and MySQL. Vercel is used
for the static Vite frontend.

## 1. Put the Code in Your Own GitHub Repository

The default remote points to the upstream teaching repository. Fork the
repository or create your own GitHub repository, then push this project there.

Do not commit `.env`; production secrets belong in Railway or Vercel variables.

## 2. Backend on Railway

Deploy the backend from the repository root using `Dockerfile.backend`.
The included `railway.json` tells Railway to use this Dockerfile and check
`/api/health` after deployment.

Required environment variables:

```env
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
OPENAI_API_KEY=your_model_api_key
LLM_QWEN_MAX=qwen-max

TAVILY_API_KEY=your_tavily_api_key

RAGFLOW_API_URL=https://your-ragflow-host
RAGFLOW_API_KEY=your_ragflow_api_key

MYSQL_USER=root
MYSQL_PASSWORD=your_mysql_password
MYSQL_DATABASE=deepsearch_db
MYSQL_HOST=your_mysql_host
MYSQL_PORT=3306
MYSQL_CHARSET=utf8mb4
MYSQL_COLLATION=utf8mb4_unicode_ci
MYSQL_SQL_MODE=TRADITIONAL
```

When using Railway MySQL, map Railway's generated variables into the names this
project expects:

```env
MYSQL_HOST=${{MySQL.MYSQLHOST}}
MYSQL_PORT=${{MySQL.MYSQLPORT}}
MYSQL_USER=${{MySQL.MYSQLUSER}}
MYSQL_PASSWORD=${{MySQL.MYSQLPASSWORD}}
MYSQL_DATABASE=${{MySQL.MYSQLDATABASE}}
```

If you do not use RAGFlow yet, you can leave the RAGFlow values empty, but
tasks that call the RAGFlow assistant will fail.

Health check:

```text
GET /api/health
```

Start command if your platform does not use the Dockerfile:

```bash
uv run uvicorn app.api.server:app --host 0.0.0.0 --port $PORT
```

## 3. Database on Railway MySQL

Create a MySQL database service inside the same Railway project as the backend.
Import the local dump from your machine:

```powershell
mysql -h <railway-tcp-host> -P <railway-tcp-port> -u <user> -p <database> < E:\Agent学习\chapter7\railway-deploy\deepsearch_mysql_export.sql
```

After import, keep the backend connected through Railway's internal variables.
Avoid leaving public TCP access open unless you need it for maintenance.

## 4. Frontend on Vercel

In Vercel, import the repository and set the project root to `frontend`.

Build settings:

```text
Install Command: pnpm install
Build Command: pnpm build
Output Directory: dist
```

Environment variables:

```env
VITE_API_BASE_URL=https://your-backend.example.com
VITE_WS_BASE_URL=wss://your-backend.example.com
```

After deploy, users open the Vercel URL. They should never see PowerShell.

## 3. Future Supabase Migration

Your preferred AI-one-person-company stack is good for new products:

- Next.js + TypeScript
- Supabase Auth and Postgres
- Stripe for payments where the business entity is supported
- Resend for transactional email
- Vercel for frontend deployment
- PostHog and Sentry for analytics and monitoring

For this specific project, Supabase is not a drop-in replacement yet because
the code currently uses MySQL tools. To move fully into that stack:

1. Convert `docker/mysql/mysql.sql` from MySQL syntax to Postgres.
2. Replace `mysql-connector-python` tools in `app/tools/db_tools.py` with
   Supabase/Postgres queries.
3. Persist task events in Supabase instead of only pushing them through
   WebSocket.
4. Replace the current Vite app with Next.js only if you want auth, billing,
   app routing, and product pages in the same frontend.
