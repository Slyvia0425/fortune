from fastapi.testclient import TestClient
from app import app

client = TestClient(app)


def test_cast_returns_decorated_chart_at_frozen_time():
    response = client.post('/divination/cast', json={
        'method': 'three_numbers', 'numbers': [1, 5, 1], 'question': '求财',
        'casting_receipt': {'cast_at': '2024-02-10T04:00:00Z', 'timezone': 'Asia/Hong_Kong'},
    })
    assert response.status_code == 200
    data = response.json()
    assert data['primary']['number'] == 44
    assert data['core_facts']['calendar']['day_ganzhi'] == '甲辰'
    assert data['core_facts']['main_lines_complete']
    assert data['core_facts']['calendar']['display_timezone'] == 'Asia/Hong_Kong'


def test_invalid_calendar_and_numbers_are_rejected():
    base = {'method': 'three_numbers', 'numbers': [1, 2, 3], 'question': '求财'}
    for patch in [
        {'numbers': [True, 2, 3]},
        {'casting_receipt': {'cast_at': '2024-02-10T04:00:00'}},
        {'casting_receipt': {'cast_at': '2024-02-10T04:00:00Z', 'timezone': 'invalid'}},
    ]:
        assert client.post('/divination/cast', json={**base, **patch}).status_code == 422
