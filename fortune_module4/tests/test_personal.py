from fastapi.testclient import TestClient

from tests.conftest import headers


def test_collections_notes_tags_export_and_delete(client: TestClient) -> None:
    collection = client.post(
        "/api/v1/me/collections",
        headers=headers(),
        json={
            "item_type": "knowledge_item",
            "source_id": "source:yijing",
            "title": "Yijing passage",
            "source_metadata": {"content_checksum": "sha256:abc"},
        },
    )
    assert collection.status_code == 201
    collection_id = collection.json()["result"]["collection_id"]

    note = client.post(
        "/api/v1/me/notes",
        headers=headers(),
        json={
            "source_id": "source:yijing",
            "collection_id": collection_id,
            "title": "My note",
            "body": "Private interpretation note",
            "tags": ["yijing", "private"],
            "source_refs": ["source:yijing"],
        },
    )
    assert note.status_code == 200
    assert note.json()["result"]["tags"] == ["yijing", "private"]

    tags = client.get("/api/v1/me/tags", headers=headers())
    assert tags.status_code == 200
    assert {tag["name"] for tag in tags.json()["result"]} == {"yijing", "private"}

    exported = client.post("/api/v1/me/exports", headers=headers())
    assert exported.status_code == 201
    exported_body = exported.json()["result"]
    assert "source:yijing" in exported_body["source_manifest"]
    assert len(exported_body["data"]["notes"]) == 1

    deleted = client.delete("/api/v1/me/data?confirm=true", headers=headers())
    assert deleted.status_code == 200
    assert deleted.json()["result"]["status"] == "deleted"

    collections = client.get("/api/v1/me/collections", headers=headers())
    assert collections.json()["result"] == []


def test_collection_tags_category_and_tag_lifecycle(client: TestClient) -> None:
    collection = client.post(
        "/api/v1/me/collections",
        headers=headers(),
        json={
            "item_type": "knowledge_search",
            "source_id": "knowledge:knowledge-2",
            "title": "五行大义",
            "source_metadata": {"module": "knowledge", "summary": "五行相生相克"},
        },
    )
    assert collection.status_code == 201
    collection_id = collection.json()["result"]["collection_id"]

    updated = client.patch(
        f"/api/v1/me/collections/{collection_id}",
        headers=headers(),
        json={"tags": ["五行", "私藏"], "category": "典籍"},
    )
    assert updated.status_code == 200
    assert updated.json()["result"]["tags"] == ["五行", "私藏"]
    assert updated.json()["result"]["category"] == "典籍"

    note = client.post(
        "/api/v1/me/notes",
        headers=headers(),
        json={"body": "五行笔记", "tags": ["五行"]},
    )
    assert note.status_code == 200
    note_id = note.json()["result"]["note_id"]

    tags = client.get("/api/v1/me/tags", headers=headers()).json()["result"]
    by_name = {tag["name"]: tag for tag in tags}
    assert by_name["五行"]["usage_count"] == 2

    renamed = client.patch(
        f"/api/v1/me/tags/{by_name['五行']['tag_id']}",
        headers=headers(),
        json={"name": "阴阳五行"},
    )
    assert renamed.status_code == 200
    assert renamed.json()["result"]["name"] == "阴阳五行"
    assert renamed.json()["result"]["usage_count"] == 2

    collections = client.get("/api/v1/me/collections", headers=headers()).json()["result"]
    assert collections[0]["tags"] == ["阴阳五行", "私藏"]
    notes = client.get("/api/v1/me/notes", headers=headers()).json()["result"]
    assert notes[0]["note_id"] == note_id
    assert notes[0]["tags"] == ["阴阳五行"]

    deleted = client.delete(
        f"/api/v1/me/tags/{by_name['五行']['tag_id']}", headers=headers()
    )
    assert deleted.status_code == 204
    collections = client.get("/api/v1/me/collections", headers=headers()).json()["result"]
    assert collections[0]["tags"] == ["私藏"]
    notes = client.get("/api/v1/me/notes", headers=headers()).json()["result"]
    assert notes[0]["tags"] == []


def test_private_collections_are_isolated_by_user(client: TestClient) -> None:
    response = client.post(
        "/api/v1/me/collections",
        headers=headers("user-a"),
        json={"item_type": "knowledge_item", "source_id": "source:private"},
    )
    assert response.status_code == 201

    other_user = client.get("/api/v1/me/collections", headers=headers("user-b"))
    assert other_user.status_code == 200
    assert other_user.json()["result"] == []


def test_privacy_defaults_and_updates(client: TestClient) -> None:
    default = client.get("/api/v1/me/privacy", headers=headers("privacy-user"))
    assert default.status_code == 200
    assert default.json()["result"]["allow_anonymous_cases"] is False

    updated = client.put(
        "/api/v1/me/privacy",
        headers=headers("privacy-user"),
        json={
            "consent_scopes": ["session_storage", "anonymous_case_matching"],
            "retention_policy": "30d",
            "allow_anonymous_cases": True,
            "allow_shared_training": False,
        },
    )
    assert updated.status_code == 200
    assert updated.json()["result"]["allow_anonymous_cases"] is True
    assert updated.json()["result"]["retention_policy"] == "30d"


def test_person_profiles_are_isolated_and_used_for_question_analysis(
    client: TestClient,
) -> None:
    profile = client.post(
        "/api/v1/me/profiles",
        headers=headers(),
        json={
            "name": "张三",
            "relation": "客户",
            "gender": "male",
            "calendar": "solar",
            "birth_date": "1990-04-18",
            "birth_time": "09:30",
            "birth_place": {"city_id": "cn-shanghai", "city": "上海"},
            "chart_snapshot": {
                "pillars": [
                    {"label": "year", "stem": "geng", "branch": "wu_branch"},
                    {"label": "month", "stem": "geng", "branch": "chen"},
                    {"label": "day", "stem": "ding", "branch": "wei"},
                    {"label": "hour", "stem": "yi", "branch": "si"},
                ],
                "day_master": {"element": "fire", "strength": "balanced"},
                "elements": {"wood": 1.2, "fire": 2.1, "earth": 1.8, "metal": 2.4, "water": 1.0},
                "disposition": {"useful": ["wood", "water"], "unfavourable": ["metal"]},
                "ten_gods": [
                    {"ten_god": "seven_killings"},
                    {"ten_god": "indirect_wealth"},
                    {"ten_god": "indirect_resource"},
                ],
                "current_period": {
                    "year": {"stem": "bing", "branch": "wu_branch", "year": 2026}
                },
                "advisory": [
                    {
                        "domain": "career",
                        "categories": [{"display_name": "专业研究"}, {"display_name": "组织协作"}],
                    }
                ],
            },
            "tags": ["重点客户"],
        },
    )
    assert profile.status_code == 200
    profile_id = profile.json()["result"]["profile_id"]
    assert profile.json()["result"]["chart_snapshot"]["pillars"][2]["stem"] == "ding"

    collection = client.post(
        "/api/v1/me/collections",
        headers=headers(),
        json={
            "item_type": "bazi_luck",
            "source_id": "bazi-luck:test-profile",
            "title": "张三 · 大运与当前节气",
            "source_metadata": {
                "module": "bazi",
                "person_name": "张三",
                "profile_id": profile_id,
                "summary": "2026 年进入新的职业调整周期。",
            },
        },
    )
    assert collection.status_code == 201
    collection_id = collection.json()["result"]["collection_id"]

    note = client.post(
        "/api/v1/me/notes",
        headers=headers(),
        json={
            "collection_id": collection_id,
            "title": "张三近期关注事项",
            "body": "重点核对岗位调整、项目责任和合同节奏。",
            "tags": ["张三", "事业"],
        },
    )
    assert note.status_code == 200

    unassigned_sign = client.post(
        "/api/v1/me/collections",
        headers=headers(),
        json={
            "item_type": "sign_record",
            "source_id": "guanyin-record:test-unassigned",
            "title": "未归档灵签 · 事业贵人",
            "source_metadata": {
                "module": "guanyin",
                "summary": "事业有贵人，今年适合推进岗位调整。",
            },
        },
    )
    assert unassigned_sign.status_code == 201

    other_profile = client.post(
        "/api/v1/me/profiles",
        headers=headers(),
        json={
            "name": "李四",
            "relation": "亲友",
            "chart_snapshot": {
                "pillars": [
                    {"label": "day", "stem": "jia", "branch": "zi"},
                ],
                "day_master": {"element": "wood", "strength": "strong"},
            },
        },
    )
    assert other_profile.status_code == 200
    other_profile_id = other_profile.json()["result"]["profile_id"]
    other_profile_collection = client.post(
        "/api/v1/me/collections",
        headers=headers(),
        json={
            "item_type": "bazi_luck",
            "source_id": "bazi-luck:test-other-profile",
            "title": "李四 · 事业大运",
            "source_metadata": {
                "module": "bazi",
                "person_name": "李四",
                "profile_id": other_profile_id,
                "summary": "这是另一个人物的职业记录，不应进入张三的分析。",
            },
        },
    )
    assert other_profile_collection.status_code == 201

    analysis = client.post(
        "/api/v1/me/analyze",
        headers=headers(),
        json={"question": "张三今年事业应该怎么判断？"},
    )
    assert analysis.status_code == 200
    result = analysis.json()["result"]
    assert result["person"]["profile_id"] == profile_id
    assert result["person"]["name"] == "张三"
    assert "分析依据" in result["answer"]
    assert "分析结论" in result["answer"]
    assert "张三" in result["answer"]
    assert "丁火" in result["answer"]
    assert "专业研究" in result["answer"]
    assert "bazi-luck:test-profile" in result["source_refs"]
    assert {record["item_type"] for record in result["used_records"]} >= {
        "bazi_luck",
        "personal_note",
    }
    assert "guanyin-record:test-unassigned" not in result["source_refs"]
    assert "bazi-luck:test-other-profile" not in result["source_refs"]
    assert {
        record["source_id"]
        for record in result["used_records"]
    }.isdisjoint({"guanyin-record:test-unassigned", "bazi-luck:test-other-profile"})

    other_user_profiles = client.get(
        "/api/v1/me/profiles",
        headers=headers("profile-owner-b"),
    )
    assert other_user_profiles.status_code == 200
    assert other_user_profiles.json()["result"] == []

    updated = client.patch(
        f"/api/v1/me/profiles/{profile_id}",
        headers=headers(),
        json={"name": "张三（回访）", "relation": "亲友", "tags": ["长期档案"]},
    )
    assert updated.status_code == 200
    assert updated.json()["result"]["name"] == "张三（回访）"

    deleted = client.delete(
        f"/api/v1/me/profiles/{profile_id}",
        headers=headers(),
    )
    assert deleted.status_code == 204
