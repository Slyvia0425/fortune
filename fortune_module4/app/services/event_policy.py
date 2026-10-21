"""Policies for distinguishing archived history from inference-eligible events."""

from typing import Final

INFERENCE_EVENT_TYPES: Final[frozenset[str]] = frozenset(
    {
        "module1.chart.completed",
        "module2a.divination.completed",
        "knowledge.item.opened",
        "recommendation.impression",
        "recommendation.click",
        "collection.created",
        "note.created",
        "tag.assigned",
        "feedback.submitted",
    }
)

CASE_EVENT_TYPES: Final[frozenset[str]] = frozenset(
    {
        "module1.chart.completed",
        "module2a.divination.completed",
    }
)

HISTORY_EVENT_TYPES: Final[frozenset[str]] = frozenset(
    {
        "conversation.message",
        "module2a.chat.user_message",
        "module2a.chat.assistant_message",
    }
)


def participates_in_inference(event_type: str) -> bool:
    """Return whether an event is trusted input for ranking and case matching."""

    return event_type.strip() in INFERENCE_EVENT_TYPES


def is_conversation_message(event_type: str) -> bool:
    """Return whether an event represents a visible chat message."""

    return event_type.strip() in HISTORY_EVENT_TYPES
