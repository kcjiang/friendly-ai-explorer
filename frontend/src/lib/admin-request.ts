// Only the current site's versioned API may receive the administrator's token.
export function adminRequestUrl(value: string, origin: string) {
  const url = new URL(value.trim(), origin);
  if (
    url.origin !== new URL(origin).origin ||
    url.username ||
    url.password ||
    !url.pathname.startsWith("/api/v1/") ||
    url.hash
  ) {
    throw new Error("Only this site's /api/v1/ endpoints are allowed.");
  }
  return url.href;
}

export function validateUserDraft(
  draft: {
    name: string;
    email: string;
    role: string;
    password: string;
    newPassword: string;
  },
  creating: boolean,
) {
  if (!draft.name.trim()) return "name";
  if (!["engineer", "leader", "developer"].includes(draft.role)) return "role";
  if (creating && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim()))
    return "email";
  if (creating && draft.password.length < 6) return "password";
  if (!creating && draft.newPassword && draft.newPassword.length < 6)
    return "newPassword";
  return null;
}
