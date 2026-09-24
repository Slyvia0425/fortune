from fastapi import APIRouter

from app.api.v1.endpoints import auth, cases, events, feedback, me, recommendations, sessions

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(sessions.router)
api_router.include_router(events.router)
api_router.include_router(recommendations.router)
api_router.include_router(cases.router)
api_router.include_router(feedback.router)
api_router.include_router(me.router)
