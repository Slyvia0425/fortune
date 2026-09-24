def test_register_login_and_current_user(client) -> None:
    registered = client.post(
        "/api/v1/auth/register",
        json={"email": "member@example.com", "password": "correct-horse-2026", "display_name": "新用户"},
    )
    assert registered.status_code == 201
    result = registered.json()["result"]
    token = result["session_token"]
    assert result["user"]["email"] == "member@example.com"

    current = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert current.status_code == 200
    assert current.json()["result"]["display_name"] == "新用户"

    logged_in = client.post(
        "/api/v1/auth/login",
        json={"email": "member@example.com", "password": "correct-horse-2026"},
    )
    assert logged_in.status_code == 200


def test_duplicate_invalid_password_and_logout(client) -> None:
    payload = {"email": "member@example.com", "password": "correct-horse-2026", "display_name": "新用户"}
    first = client.post("/api/v1/auth/register", json=payload)
    assert first.status_code == 201
    assert client.post("/api/v1/auth/register", json=payload).status_code == 409
    assert client.post(
        "/api/v1/auth/login",
        json={"email": payload["email"], "password": "incorrect-password"},
    ).status_code == 401

    token = first.json()["result"]["session_token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert client.post("/api/v1/auth/logout", headers=headers).status_code == 204
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401


def test_authenticated_users_are_isolated(client) -> None:
    def register(email: str) -> str:
        response = client.post(
            "/api/v1/auth/register",
            json={"email": email, "password": "correct-horse-2026", "display_name": email},
        )
        return response.json()["result"]["session_token"]

    token_a = register("a@example.com")
    token_b = register("b@example.com")
    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}
    created = client.post(
        "/api/v1/me/notes",
        headers=headers_a,
        json={"title": "A 的笔记", "body": "private", "tags": []},
    )
    assert created.status_code == 200
    assert len(client.get("/api/v1/me/notes", headers=headers_a).json()["result"]) == 1
    assert client.get("/api/v1/me/notes", headers=headers_b).json()["result"] == []


def test_password_reset_revokes_existing_sessions(client) -> None:
    registered = client.post(
        "/api/v1/auth/register",
        json={"email": "reset@example.com", "password": "old-password-2026", "display_name": "重置用户"},
    ).json()["result"]
    reset_request = client.post(
        "/api/v1/auth/forgot-password", json={"email": "reset@example.com"}
    )
    token = reset_request.json()["result"]["debug_token"]
    assert token
    assert client.post(
        "/api/v1/auth/reset-password",
        json={"token": token, "password": "new-password-2026"},
    ).status_code == 204
    assert client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {registered['session_token']}"},
    ).status_code == 401
    assert client.post(
        "/api/v1/auth/login",
        json={"email": "reset@example.com", "password": "new-password-2026"},
    ).status_code == 200
