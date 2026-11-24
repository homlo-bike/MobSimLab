"""Notes and problems of a road run as messages the app shows in its language.

Each note is its English text and a message: a key of the road simulation's messages in the app
(apps/web/src/i18n/road) and the values for its ``{name}`` placeholders. A value is text, a number (the app
writes it the language's way) or a message of its own, for a part of the sentence. Runs saved before
messages have plain English text, which the app shows as it is.
"""

from __future__ import annotations

from typing import Any

#: A message: ``{"key": ..., "args": {...}}``.
Msg = dict[str, Any]

#: A note or a problem: ``{"text": English text, "msg": Msg}``.
Note = dict[str, Any]


def msg(key: str, **args: Any) -> Msg:
    """A message with its values (text, numbers or messages)."""
    return {"key": key, "args": args} if args else {"key": key}


def note(text: str, key: str, **args: Any) -> Note:
    """A note: its English text and its message."""
    return {"text": text, "msg": msg(key, **args)}
