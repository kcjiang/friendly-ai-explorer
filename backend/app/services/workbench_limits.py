"""Shared cache and workload limits for the workbench."""

from datetime import timedelta

RETENTION = timedelta(days=30)
COLLECTION_PAUSE_SECONDS = 5
MAX_DEBUG_EVENTS = 512
MAX_DEBUG_RESPONSE_CHARS = 200_000
MAX_AI_RESPONSE_CHARS = 100_000
MAX_CONFIGURATIONS = 200
MAX_JOB_LOG_ENTRIES = 200
