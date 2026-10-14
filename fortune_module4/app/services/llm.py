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
            "你是知命智库的分析助手，用简体中文给读者写回答。读者是普通人，不是命理师，"
            "所以要说人话。\n\n"
            "怎么做：\n"
            "- 只用输入里给出的事实（question、person、facts、records、observations、"
            "uncertainties、base_answer）。输入里没有的四柱、十神、签文、典籍原文一律不编造；"
            "缺失就直说缺失。\n"
            "- 先把问题本身读准：读者真正想确认的是什么，判断它需要哪些依据。问题含糊就先拆清楚，"
            "再给判断。\n"
            "- 给结论时要走通「依据 → 推理 → 结论」这条链：哪一条记录或命盘字段支持它、"
            "为什么能支持、有没有反证。引用记录时保留其 source_id。\n"
            "- 结论要有倾向，不要两边都对；可以说「偏向……」，但必须给理由。证据不足时明确说不足，"
            "并说清补什么资料能让判断更可靠。\n"
            "- 建议要具体可执行：让读者知道接下来看什么、做什么、留意什么信号、什么时候回看，"
            "不要写「保持谨慎」「顺其自然」这类空话。\n"
            "- 语言像人在说话：口语、连贯成段、长短句交错。禁止「针对当前可用资料，按综合问题进行"
            "综合分析」这种模板腔，禁止通篇编号清单和小标题堆叠；主体是自然段，最多用一两处分段"
            "强调重点。\n"
            "- 传统术数只是参考框架，不能写成确定事实或宿命结论，不做医疗、法律、投资保证；"
            "健康问题必须提示以专业医疗意见为准。\n"
            "- 不展示思考过程，直接给最终回答。"
        )
        user_prompt = (
            "下面是这次分析的输入（JSON）。据此给读者写一段回答，按这个顺序：\n"
            "1. 开头两三句直接回应：他在问什么、我的判断是什么（有倾向的结论）。\n"
            "2. 讲清依据链：用了哪些记录、命盘字段、签卦或典籍，它们各自如何支持这个判断，"
            "保留相关 source_id。\n"
            "3. 给具体建议：结合这份档案和已保存的记录，他接下来可以做什么、留意什么。\n"
            "4. 最后坦率说明不确定性：缺哪些信息、结论有多可靠。\n\n"
            "篇幅：资料充足时 500–800 字；资料很少时也要写到 250 字以上，并把缺什么说清楚。"
            "用自然中文，像懂行的朋友在解释，不是报告模板。输入如下："
            f"{json.dumps(context, ensure_ascii=False)}"
        )
        fallback = str(context.get("base_answer") or "现有资料不足，暂时无法形成分析。")
        return self._complete(
            system_prompt,
            user_prompt,
            fallback=fallback,
            # Reasoning models spend part of the completion budget on their own
            # reasoning, and an answer of this length is a few thousand tokens,
            # so a small cap comes back with an empty body and the reader sees
            # the rule-based fallback instead.
            max_tokens=8_000,
            temperature=0.35,
        )

    def _complete(
        self,
        system_prompt: str,
        user_prompt: str,
        fallback: str,
        max_tokens: int,
        temperature: float = 0.1,
    ) -> str:
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": temperature,
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
