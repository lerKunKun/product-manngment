# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout (4 subprojects)

- `backend-api/` — Spring Boot 3.3 + Java 21 + MyBatis-Plus + Flyway. Package root `com.biou.shopifyhub`. Domain modules sit as siblings under that root (`auth`, `org`, `rbac`, `store`, `product`, `push`, `snapshot`, `approval`, `notification`, `audit`, `ops`, `webhook`, ...).
- `frontend-admin/` — Next.js 15 (App Router) + React 19 + TanStack Query + shadcn/ui + TipTap + Playwright. Authed routes live under `app/(authed)/`.
- `asset-worker/` — FastAPI + Shopify CLI / Admin SDK + R2 SDK. Handles theme/product/file/menu/policy/collection pull and push, plus preview build.
- `ops/` — bootstrap, deploy, monitoring (Prometheus/Grafana/Loki/Alertmanager), backup, disaster-recovery, release SOPs.

`bin/` contains the dev-loop scripts; `.githooks/pre-commit` is the project-managed git hook.

## Daily dev loop

```bash
# 1. middleware (mysql:3307 / redis:6380 / rabbit:5672+15672 / minio:9000+9001 / asset-worker:8765)
./bin/dev-up.sh

# 2. backend (separate terminal — exec mvn spring-boot:run, foreground for logs)
./bin/dev-backend.sh

# 3. frontend (separate terminal — pnpm dev)
./bin/dev-frontend.sh

# end-to-end smokes
./bin/smoke-test.sh    # 6 checks
./bin/e2e-saga.sh      # 18-step one-click newstore saga
./bin/e2e-wave4.sh     # ~28 steps: approval / notify / email / archive / monitoring / admin
```

Default login: `admin` / `admin123`. Backend `/api`, frontend `/`, RabbitMQ console `:15672` (guest/guest), MinIO console `:9001` (minioadmin/minioadmin).

**Local ports are deliberately offset** (mysql 3307, redis 6380) to avoid colliding with `brew services` mysql@8.0/redis on 3306/6379. Don't switch them back without checking — the `.env` and `application-dev.yml` defaults assume the offset.

`./bin/dev-backend.sh` does its own `.env` parsing (handles multi-line PEM values, never overrides existing env). Maven does **not** load `.env` on its own — running `mvn spring-boot:run` directly will fail without env.

## Build / test / lint

### Backend (`backend-api/`)

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@21 mvn -DskipTests compile     # incremental compile (used by pre-commit)
mvn test                                                            # runs tests + jacoco report
mvn verify                                                          # what CI runs
mvn -Dtest=ApprovalEngineTest test                                  # single test class
mvn -Dtest=ApprovalEngineTest#approve_when_role_any test            # single method
open target/site/jacoco/index.html                                  # coverage HTML
```

Tests need MySQL + Redis + RabbitMQ reachable (CI provides them as service containers; locally `./bin/dev-up.sh`). Jacoco excludes `entity/`, `dto/`, `config/`, `Application` from coverage.

### Frontend (`frontend-admin/`)

```bash
pnpm dev                                # next dev :3000
pnpm typecheck                          # tsc --noEmit (used by pre-commit)
pnpm lint                               # next lint
pnpm build                              # production build
pnpm test:e2e                           # Playwright (needs backend + frontend running)
pnpm test:e2e -- e2e/login.spec.ts      # single spec
pnpm test:e2e:ui                        # Playwright UI mode
pnpm test:e2e:install                   # install chromium first time
```

Pinned to `pnpm@9.12.3` via `packageManager`. React is on a 19 RC, so `@types/react` is overridden to `types-react@rc` — don't "fix" the override.

### Worker (`asset-worker/`)

```bash
pip install -r requirements-dev.txt
ruff check app
pytest -q                               # all tests
pytest tests/test_product_push.py       # single file
pytest tests/test_product_push.py::test_idempotent   # single test
```

## Architecture rules to respect

These are project conventions that aren't obvious from reading the code; violating them is the kind of thing a reviewer will reject:

- **Cross-module backend calls go through RabbitMQ events, not direct `@Autowired Service`.** This is enforced by convention (see `系统设计文档.md` §14 and `并行任务编排.md`). When you need module B to react to module A, publish an event from A and consume in B.
- **Cross-datasource transactions are forbidden.** Backend uses `dynamic-datasource` with `primary: platform` and per-tenant datasources `tenant_01..05` loaded from `sys_tenant_datasource`. A `@Transactional` block must not span multiple datasources — if you need that, split it via events + outbox / saga.
- **Flyway versions are pre-claimed per work track.** Migrations live in `backend-api/src/main/resources/db/migration/V{N}__*.sql` (currently V1..V32+). Before adding a migration, check `并行任务编排.md` / sprint 编排 docs for whether your version number is reserved for someone else's track. Don't renumber existing migrations.
- **Sensitive ops use `@RequireSensitiveOp` AOP.** Don't bypass; don't wrap business code that doesn't actually need re-auth.
- **Webhook snapshots are debounced** at `shopify.snapshot.debounce-seconds` (default 300s). The same `(store, product)` pair within that window only triggers one downstream snapshot.
- **`shopify.dev-mock-oauth: true` is dev-only.** It bypasses real Shopify OAuth in the saga. Production must set false.
- **Cache layer fails open.** `cache.enabled` default true, default TTL 300s; Redis errors degrade to DB with a WARN log — never make a code path require Redis to be up.

## Pre-commit hook

Project ships `.githooks/pre-commit`. Enable once per clone:

```bash
chmod +x .githooks/pre-commit
git config core.hooksPath .githooks
```

It runs four checks on staged content:
1. Refuses staged `.env`, `配置信息.md`, `*.key`, `*.pem`, `.secrets/*`.
2. Greps the diff for secret patterns (`shpss_…`, `shpat_…`, `wpat_…`, `sk_live_…`, `sk_test_…`, `aws_secret_access_key`, `atE…`).
3. If any `frontend-admin/**/*.{ts,tsx}` is staged: runs `pnpm tsc --noEmit`.
4. If any `backend-api/**/*.java` is staged: runs `mvn -DskipTests compile`.

Bypass with `git commit --no-verify` only if you know what you're doing — CI re-runs typecheck and compile, so a bypass just defers the failure.

## CI (.github/workflows/ci.yml)

Seven jobs: `frontend` (typecheck + lint + build), `backend` (mvn verify + jacoco upload, with mysql/redis/rabbit services), `worker` (ruff + pytest), `security-scan` (Trivy fs HIGH/CRITICAL, currently non-blocking), `e2e-wave4` (boots backend + runs `bin/e2e-wave4.sh`, currently `continue-on-error: true`), `e2e-frontend` (Playwright, also `continue-on-error: true`). The two e2e jobs are flaky-tolerant on purpose; tighten only with the maintainer's call.

## Documentation map

The repo has heavy Chinese-language design docs at the root. When you need context beyond what code can tell you:

- **Architecture** → `系统设计文档.md` (14 sections)
- **Feature catalog** → `系统功能说明.md`
- **Open work / blockers** → `TODO清单.md` (P0 ship-blockers), `技术债登记.md`
- **Sprint plans** → `并行改进编排-Sprint{2..9}.md`
- **History (what was actually shipped)** → `改进迭代史.md`, `进度记录.md`
- **Audit of design vs code** → `项目检查报告.md`
- **External account / credential setup** → `配置指南.md`
- **Ops** → everything under `ops/`

When a design doc disagrees with the code, the code is the source of truth — but flag the divergence (the `项目检查报告` style) instead of silently bringing the code in line with a stale doc.
