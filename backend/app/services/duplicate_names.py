"""Shared display-name allocation: base, base (2), base (3), ... ."""

from collections.abc import Collection


def first_available_name(base: str, occupied: Collection[str]) -> str:
    names = set(occupied)
    candidate = base
    number = 2
    while candidate in names:
        candidate = f"{base} ({number})"
        number += 1
    return candidate
