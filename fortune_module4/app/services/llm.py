import json
from abc import ABC, abstractmethod
from functools import lru_cache
from typing import Any

import httpx

from app.core.config import get_settings


class ExplanationProvider(ABC):
    @property
    @abstractmethod
    def name(self) -> str:
        raise NotImplementedError

    @abstractmethod
    def explain_recommendation(self, context: dict[str, Any]) -> str:
        raise NotImplementedError

    @abstractmethod
    def explain_similar_case(self, context: dict[str, Any]) -> str:
        raise NotImplementedError

    @abstractmethod
    def analyze_personal_records(self, context: dict[str, Any]) -> str:
        raise NotImplementedError


class TemplateExplanationProvider(ExplanationProvider):
    @property
    def name(self) -> str:
        return "template-explainer-v1"

    def explain_recommendation(self, context: dict[str, Any]) -> str:
        title = context.get("title") or context.get("item_id") or "this item"
        features = context.get("features") or {}
        strongest = sorted(features.items(), key=lambda item: item[1], reverse=True)[:2]
        reasons = ", ".join(f"{name}={value:.2f}" for name, value in strongest)
        refs = context.get("source_refs") or []
        reference_text = f" Sources: {', '.join(refs[:3])}." if refs else ""
        reason_text = reasons or "the available ranking features"
        return f"Recommended {title} because {reason_text} scored highest.{reference_text}"

    def explain_similar_case(self, context: dict[str, Any]) -> str:
        similarities = context.get("similarities") or []
        differences = context.get("key_differences") or []
        similar_text = "; ".join(similarities[:2]) or "the available anonymized features are close"
        difference_text = "; ".join(differences[:1]) or "some features were not available"
        return f"Similar because: {similar_text}. Key difference: {difference_text}."

    def analyze_personal_records(self, context: dict[str, Any]) -> str:
        return str(context.get("base_answer") or "现有资料不足，暂时无法形成分析。")


class OpenAICompatibleExplanationProvider(ExplanationProvider):
    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        timeout: float,
        reasoning_effort: str | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._timeout = timeout
        self._reasoning_effort = reasoning_effort
        self._fallback = TemplateExplanationProvider()

    @property
    def name(self) -> str:
        return self._model

    def explain_recommendation(self, context: dict[str, Any]) -> str:
        system_prompt = (
            "You explain recommendations using only the supplied items, scores, preferences, "
            "and source_refs. Do not add facts or alter any deterministic result."
        )
        user_prompt = (
            "Explain in at most 80 Chinese characters why this item is recommended and list "
            "one to three source ids. Say clearly when evidence is insufficient. Context: "
            f"{json.dumps(context, ensure_ascii=False)}"
        )
        return self._complete(
            system_prompt,
            user_prompt,
            fallback=self._fallback.explain_recommendation(context),
            max_tokens=256,
        )

    def explain_similar_case(self, context: dict[str, Any]) -> str:
        system_prompt = (
            "You explain anonymized case similarity using only the supplied structured features. "
            "Do not infer identity or make deterministic fate claims."
        )
        user_prompt = (
            "请使用简体中文，至少说明两个相似点和至少一个关键差异，不要推断身份或命运。Context: "
            f"{json.dumps(context, ensure_ascii=False)}"
        )
        return self._complete(
            system_prompt,
            user_prompt,
            fallback=self._fallback.explain_similar_case(context),
            max_tokens=320,
        )

    def analyze_personal_records(self, context: dict[str, Any]) -> str:
        system_prompt = (
            "你是知命智库的分析助手。只能依据输入中的人物档案、命盘字段、签卦记录、"
            "个人笔记和来源信息作答；不得编造缺失字段，不得把传统术数判断写成确定事实，"
            "不得提供医疗、法律或投资保证。健康问题只能按传统文化作身心状态提醒，"
            "不得作疾病判断，并应明确建议以专业医疗意见为准。请使用简体中文，"
            "直接输出最终分析，不展示思考过程。"
        )
        user_prompt = (
            "请针对 question 给出切实的分析，而不是只罗列来源。要求：先明确分析对象和问题领域；"
            "然后解释命盘结构与问题的关系；再结合签卦、典籍和个人笔记形成结论；最后列出不确定性。"
            "保留输入中的 record source_id，不要改动原始事实。输入如下："
            f"{json.dumps(context, ensure_ascii=False)}"
        )
        fallback = str(context.get("base_answer") or "现有资料不足，暂时无法形成分析。")
        return self._complete(
            system_prompt,
            user_prompt,
            fallback=fallback,
            max_tokens=1_400,
        )

    def _complete(
        self,
        system_prompt: str,
        user_prompt: str,
        fallback: str,
        max_tokens: int,
    ) -> str:
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.1,
            "max_tokens": max_tokens,
        }
        if self._reasoning_effort:
            payload["reasoning_effort"] = self._reasoning_effort

        try:
            response = httpx.post(
                f"{self._base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self._api_key}"},
                json=payload,
                timeout=self._timeout,
            )
            response.raise_for_status()
            body = response.json()
            content = body["choices"][0]["message"]["content"]
            if isinstance(content, str) and content.strip():
                return content.strip()
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError):
            pass

        return fallback


@lru_cache(maxsize=1)
def get_explanation_provider() -> ExplanationProvider:
    settings = get_settings()
    provider = settings.llm_provider.strip().lower()
    if (
        provider in {"openai-compatible", "openai_compatible", "api"}
        and settings.llm_base_url
        and settings.llm_api_key
    ):
        return OpenAICompatibleExplanationProvider(
            base_url=settings.llm_base_url,
            api_key=settings.llm_api_key.get_secret_value(),
            model=settings.llm_model,
            timeout=settings.llm_timeout_seconds,
            reasoning_effort=settings.llm_reasoning_effort,
        )
    return TemplateExplanationProvider()
