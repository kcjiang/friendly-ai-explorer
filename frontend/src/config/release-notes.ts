// Keys must match frontend/package.json versions (without the "v" prefix).
// Keep all published entries and insert new versions at the top (newest first).
export const releaseNotes: Record<string, { title: string; items: string[] }> =
  {
    "0.3.1-dev.3": {
      title: "English and Simplified Chinese interfaces",
      items: [
        "Added browser language detection and a session language switch beside the theme button.",
        "Localized interface labels, calendars, validation and system errors while preserving business content.",
        "AI output follows the interface language; queued and scheduled tasks retain their language snapshots.",
        "Updated fresh database initialization and synchronized development container dependencies on startup.",
      ],
    },
    "0.3.1-dev.2": {
      title: "Workbench and AI service updates",
      items: [
        "Added workbench mail, message workflows and automation.",
        "Added multiple AI providers, capability verification and embedding service switching.",
        "Improved tickets, clean database initialization and credential encryption.",
        "Replaced the old AI task and mail analysis entries with the workbench.",
      ],
    },
    "0.2.5-dev.4": {
      title: "Catalog redesign and database improvements",
      items: [
        "Unified the UI with shadcn/ui Base styles.",
        "Improved record preview and editing dialogs.",
        "Improved duplicate name handling.",
        "Improved database initialization.",
      ],
    },
    "0.2.1-dev.1": {
      title: "Local embedding services and AI tasks",
      items: [
        "Added knowledge embeddings with local OpenAI-compatible services, Gemini and keyword-only search.",
        "Improved vector search compatibility, isolated indexes by model configuration and added manual rebuilding.",
        "Added AI tasks with encrypted Jira accounts, project or JQL filters, manual checks and background schedules.",
        "Added issue drafts from Jira using templates, preview editing, missing field highlights, copying, processing status and execution history.",
      ],
    },
    "0.2.0-dev.1": {
      title: "Multi-model routing and AI debugging",
      items: [
        "Added Gemini and OpenAI-compatible AI services with primary and fallback routing per task.",
        "Improved local Qwen support with thinking, structured output, timeout and retry settings.",
        "Added application logs with filtering, automatic refresh and request ID correlation for AI calls.",
        "Fixed embedding failures and added keyword fallback, index status, rebuilding and source citations.",
      ],
    },
    "0.1.0-dev.3": {
      title: "New features",
      items: [
        "Added customer, product and project catalogs with relationships, search, sorting and audit fields.",
        "Improved ticket interactions and added Markdown issue descriptions.",
        "Fixed catalog navigation flicker on refresh and added a GitHub bug reporting entry.",
      ],
    },
    "0.1.0-dev.2": {
      title: "Bug fixes",
      items: [
        "Fixed logo colors in dark mode. (Bug #1)",
        "Rebuilt the sign-in page with shadcn/ui.",
        "Fixed trailing slash redirects that caused proxy errors and added route regression tests.",
        "Standardized development on Node 22 and pnpm 9.15.9.",
      ],
    },
    "0.1.0-dev.1": {
      title: "Development preview",
      items: [
        "Initial Docker deployment with frontend, backend and database functionality.",
      ],
    },
  };
