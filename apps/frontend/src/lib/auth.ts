export type Session = { token: string; user: { id: string; email: string } };

const key = "ai-interviewer-session";

export function getSession(): Session | null {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}

export function saveSession(session: Session) { localStorage.setItem(key, JSON.stringify(session)); }
export function clearSession() { localStorage.removeItem(key); }
export function authHeaders() {
  const session = getSession();
  return session ? { Authorization: `Bearer ${session.token}` } : {};
}
