from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str
    REDIS_URL: str
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    ADMIN_USERNAME: str = "admin"
    ADMIN_EMAIL: str = "admin@deadnet.local"
    ADMIN_PASSWORD: str = "Admin@Deadnet1"

    # Architect JWT signing secret — shared across all Architect accounts
    # Individual Architect credentials are loaded dynamically from env vars:
    # ARCHITECT_1_CALLSIGN / ARCHITECT_1_PASSWORD, ARCHITECT_2_CALLSIGN / ..., etc.
    ARCHITECT_SECRET: str = "GENERATE_64_CHAR_RANDOM_STRING"

    # SMTP / Email
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM_NAME: str = "DEADNET"
    SMTP_FROM_EMAIL: str = ""
    SMTP_TLS: bool = True
    SMTP_SSL: bool = False

    # Frontend base URL — used in email links
    FRONTEND_URL: str = "http://localhost:5173"

    model_config = {"env_file": ".env"}


settings = Settings()

