"""Local wall-clock slots, evaluated in UTC to handle DST gaps and repeats."""

from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo


def working(schedule, instant):
    local = instant.astimezone(ZoneInfo(schedule["timezone"]))
    day = local.weekday() in schedule["weekdays"]
    return day and time.fromisoformat(schedule["start"]) <= local.time().replace(
        tzinfo=None
    ) <= time.fromisoformat(schedule["end"])


def next_slot(schedule, after, inclusive=False):
    if not schedule["enabled"]:
        return None
    zone = ZoneInfo(schedule["timezone"])
    first = after.astimezone(zone).date()
    for delta in range(370):
        day = first + timedelta(days=delta)
        if day.weekday() not in schedule["weekdays"]:
            continue
        start = datetime.fromisoformat(f"{day}T{schedule['start']}")
        end = datetime.fromisoformat(f"{day}T{schedule['end']}")
        candidates = set()
        while start <= end:
            for fold in (0, 1):
                candidate = start.replace(tzinfo=zone, fold=fold).astimezone(
                    timezone.utc
                )
                if candidate.astimezone(zone).replace(tzinfo=None) == start:
                    if candidate > after or inclusive and candidate == after:
                        candidates.add(candidate)
            start += timedelta(minutes=schedule["interval_minutes"])
        if candidates:
            return min(candidates)
    return None
