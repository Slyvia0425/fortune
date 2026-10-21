"""A public deployment must not serve the local identity fallbacks."""

from app.core.config import Settings, server_safety_problems


def _settings(**overrides: object) -> Settings:
    base = {
        "environment": "production",
        "MODULE4_DEBUG": False,
        "allow_legacy_user_header": False,
        "require_user_header": True,
        "auto_create_tables": False,
    }
    base.update(overrides)
    return Settings(**base)  # type: ignore[arg-type]


def test_local_environments_keep_the_convenient_defaults() -> None:
    for environment in ("development", "local", "test", "docker"):
        assert server_safety_problems(Settings(environment=environment)) == []


def test_public_environment_reports_every_unsafe_default() -> None:
    problems = server_safety_problems(
        Settings(
            environment="production",
            MODULE4_DEBUG=True,  # type: ignore[call-arg]
            allow_legacy_user_header=True,
            require_user_header=False,
            auto_create_tables=True,
        )
    )
    reported = " ".join(problems)
    assert "ALLOW_LEGACY_USER_HEADER" in reported
    assert "REQUIRE_USER_HEADER" in reported
    assert "MODULE4_DEBUG" in reported
    assert "AUTO_CREATE_TABLES" in reported


def test_public_environment_accepts_a_server_configuration() -> None:
    assert server_safety_problems(_settings()) == []


def test_compat_routes_file_a_session_under_its_own_user(client) -> None:
    """The note bridge used to write as DEV_USER_ID even when signed in."""
    registered = client.post(
        "/api/v1/auth/register",
        json={
            "email": "bridge@example.com",
            "password": "correct-horse-2026",
            "display_name": "桥接用户",
        },
    )
    result = registered.json()["result"]
    token = result["session_token"]
    user_id = result["user"]["id"]

    saved = client.post(
        "/api/user/notes",
        headers={"Authorization": f"Bearer {token}"},
        json={"title": "会话来源的笔记", "content": "内容", "source_refs": []},
    )
    assert saved.status_code == 200

    mine = client.get(
        "/api/v1/me/notes",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert [note["title"] for note in mine.json()["result"]] == ["会话来源的笔记"]

    # Nothing may have landed on the anonymous fallback account.
    anonymous = client.get("/api/v1/me/notes", headers={"X-User-Id": "test-user"})
    assert anonymous.json()["result"] == []
    assert user_id != "test-user"


def test_compat_routes_reject_an_invalid_session(client) -> None:
    rejected = client.post(
        "/api/user/notes",
        headers={"Authorization": "Bearer not-a-real-session"},
        json={"title": "标题", "content": "内容", "source_refs": []},
    )
    assert rejected.status_code == 401
