from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ZH_", env_file=".env", extra="ignore")

    ll2_base_url: str = "https://ll.thespacedevs.com/2.3.0"
    # Optional Launch Library 2 token. Without one the free tier allows 15 requests/hour.
    ll2_api_token: str | None = None
    fetch_limit: int = 100
    # 10 minutes keeps us at 6 upstream calls/hour, well inside the free tier.
    cache_ttl_seconds: int = 600
    request_timeout_seconds: float = 20.0
    cors_origins: list[str] = ["*"]
    # Dev convenience: serve the static frontend from this process.
    serve_frontend: bool = False


settings = Settings()
