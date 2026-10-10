from functools import lru_cache

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "fortune-module4"
    environment: str = "development"
    debug: bool = Field(default=True, validation_alias="MODULE4_DEBUG")
    api_prefix: str = "/api/v1"

    database_url: str = "sqlite:///./module4.db"
    auto_create_tables: bool = True

    dev_user_id: str = "dev-user"
    require_user_header: bool = False
    allow_legacy_user_header: bool = True
    auth_session_days: int = Field(default=30, ge=1, le=365)

    embedding_provider: str = "hash"
    embedding_model: str = "BAAI/bge-m3"
    embedding_dim: int = Field(default=1024, ge=1)

    llm_provider: str = "template"
    llm_model: str = "qwen3.8:27b"
    llm_base_url: str | None = None
    llm_api_key: SecretStr | None = None
    llm_timeout_seconds: float = Field(default=600.0, gt=0)
    llm_reasoning_effort: str | None = "none"

    cors_origins: str = (
        "http://localhost:3000,http://127.0.0.1:3000,"
        "http://localhost:5173,http://127.0.0.1:5173"
    )

    recommendation_weights_json: str | None = None
    case_similarity_threshold: float = Field(default=0.60, ge=0, le=1)

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
