from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_env: str = "dev"
    app_port: int = 9000
    asset_worker_token: str = "dev-worker-token"

    # R2 / MinIO
    r2_endpoint: str = "http://localhost:9000"
    r2_access_key_id: str = "minioadmin"
    r2_secret_access_key: str = "minioadmin"
    r2_bucket: str = "shopify-assets-dev"
    r2_public_base: str = "http://localhost:9000/shopify-assets-dev"
    r2_region: str = "auto"

    # MQ
    mq_host: str = "localhost"
    mq_port: int = 5672
    mq_user: str = "guest"
    mq_pass: str = "guest"

    # Shopify
    shopify_api_version: str = "2024-10"

    # Worker behavior
    worker_dry_run: bool = False

    # W2-AST-05 — SSE progress callback (worker → backend)
    backend_progress_url: str = ""
    internal_api_token: str = ""


settings = Settings()
