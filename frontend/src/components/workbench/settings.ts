import type { Account, Step } from "@/types/workbench";

export const stepLabels: Record<Step["type"], string> = {
  read: "Read message and notes",
  ai: "AI processing",
  map: "Map fields",
  ticket: "Create ticket",
  result: "Record result",
};
export const platforms = { jira: "Jira", youtrack: "YouTrack" };
export const defaultAccount = {
  name: "",
  platform: "jira" as Account["platform"],
  base_url: "",
  username: "",
  password: "",
  project_id: "",
  mail_folder_id: "",
  enabled: true,
};
export type AccountDraft = typeof defaultAccount & { id?: string };
