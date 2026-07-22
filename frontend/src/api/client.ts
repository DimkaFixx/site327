import type { AccessGroup, AccessGroupPayload, AccessRules, AuditEventItem, Audience, DocItem, DocsSection, FormItem, FormTab, HomePage, Session, Soldier, UserAccount, VerificationCodeAdminItem } from "../types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

function readCookie(name: string) {
  const prefix = `${name}=`;
  return document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length) ?? "";
}

function withCsrf(headers: Headers, method?: string) {
  const normalizedMethod = (method || "GET").toUpperCase();
  if (!["POST", "PATCH", "DELETE"].includes(normalizedMethod)) return;
  const token = readCookie("star327_csrf");
  if (token) headers.set("X-CSRF-Token", decodeURIComponent(token));
}

function saveSession(session: Session) {
  const safeSession = { ...session, token: "", refresh_token: "" };
  localStorage.removeItem("star327_token");
  localStorage.removeItem("star327_refresh_token");
  localStorage.setItem("star327_session", JSON.stringify(safeSession));
  window.dispatchEvent(new CustomEvent("star327-session", { detail: safeSession }));
}

function clearSession() {
  localStorage.removeItem("star327_token");
  localStorage.removeItem("star327_refresh_token");
  localStorage.removeItem("star327_session");
  window.dispatchEvent(new CustomEvent("star327-session", { detail: null }));
}

async function readErrorMessage(response: Response) {
  const fallback = `HTTP ${response.status}`;
  const text = await response.text();
  if (!text) return fallback;
  try {
    const payload = JSON.parse(text) as { detail?: unknown };
    if (typeof payload.detail === "string") return payload.detail;
    if (Array.isArray(payload.detail)) {
      return payload.detail
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object" && "msg" in item) return String(item.msg);
          return "";
        })
        .filter(Boolean)
        .join("; ") || fallback;
    }
  } catch {
    return text;
  }
  return text;
}

async function refreshSession(): Promise<Session> {
  const response = await fetch(`${API_URL}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
  });
  if (!response.ok) {
    clearSession();
    throw new Error("Сессия истекла, войдите заново");
  }
  const session = (await response.json()) as Session;
  saveSession(session);
  return session;
}

async function request<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  withCsrf(headers, options.method);

  const response = await fetch(`${API_URL}${path}`, { ...options, credentials: "include", headers });
  if (!response.ok) {
    const message = await readErrorMessage(response);
    if (response.status === 401 && retry && !path.startsWith("/api/auth/")) {
      await refreshSession();
      return request<T>(path, options, false);
    }
    throw new Error(message || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function uploadRequest<T>(path: string, body: FormData, retry = true): Promise<T> {
  const headers = new Headers();
  withCsrf(headers, "POST");

  const response = await fetch(`${API_URL}${path}`, { method: "POST", credentials: "include", headers, body });
  if (!response.ok) {
    const message = await readErrorMessage(response);
    if (response.status === 401 && retry) {
      await refreshSession();
      return uploadRequest<T>(path, body, false);
    }
    throw new Error(message || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  login: (nickname: string, password?: string) =>
    request<Session>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ nickname, password: password || undefined }),
    }),
  refreshSession,
  saveSession,
  clearSession,
  logout: async () => {
    const headers = new Headers();
    withCsrf(headers, "POST");
    await fetch(`${API_URL}/api/auth/logout`, { method: "POST", credentials: "include", headers });
    clearSession();
  },
  setPassword: (password: string) =>
    request<Session>("/api/auth/password", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  resendVerificationCode: () =>
    request<Session>("/api/auth/verification/resend", {
      method: "POST",
    }),
  confirmVerificationCode: (code: string) =>
    request<Session>("/api/auth/verification/confirm", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  home: () => request<HomePage>("/api/home"),
  soldiers: () => request<Soldier[]>("/api/soldiers"),
  forms: () => request<FormTab[]>("/api/forms"),
  docs: () => request<DocsSection[]>("/api/docs"),
  doc: (id: string) => request<DocItem>(`/api/docs/${encodeURIComponent(id)}`),
  adminStore: () => request<{ tabs: FormTab[] }>("/api/admin/forms-store"),
  adminDocsStore: () => request<{ sections: DocsSection[] }>("/api/admin/docs-store"),
  accessRules: () => request<AccessRules>("/api/admin/access-rules"),
  docAccessRules: () => request<AccessRules>("/api/admin/doc-access-rules"),
  createAccessGroup: (payload: AccessGroupPayload) =>
    request<AccessGroup>("/api/admin/access-groups", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateAccessGroup: (id: string, payload: AccessGroupPayload) =>
    request<AccessGroup>(`/api/admin/access-groups/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteAccessGroup: (id: string) =>
    request<{ deleted: boolean }>(`/api/admin/access-groups/${encodeURIComponent(id)}`, { method: "DELETE" }),
  createDocAccessGroup: (payload: AccessGroupPayload) =>
    request<AccessGroup>("/api/admin/doc-access-groups", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateDocAccessGroup: (id: string, payload: AccessGroupPayload) =>
    request<AccessGroup>(`/api/admin/doc-access-groups/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteDocAccessGroup: (id: string) =>
    request<{ deleted: boolean }>(`/api/admin/doc-access-groups/${encodeURIComponent(id)}`, { method: "DELETE" }),
  adminUsers: () => request<UserAccount[]>("/api/admin/users"),
  adminVerificationCodes: () => request<VerificationCodeAdminItem[]>("/api/admin/verification-codes"),
  deleteVerificationCodes: (nickname: string) =>
    request<{ deleted: number }>(`/api/admin/verification-codes/${encodeURIComponent(nickname)}`, { method: "DELETE" }),
  adminAudit: () => request<AuditEventItem[]>("/api/admin/audit"),
  updateHome: (payload: HomePage) =>
    request<HomePage>("/api/admin/home", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  resetUserPassword: (nickname: string) =>
    request<{ reset: boolean }>(`/api/admin/users/${encodeURIComponent(nickname)}/password`, { method: "DELETE" }),
  updateUserRoles: (nickname: string, isAdmin: boolean) =>
    request<UserAccount>(`/api/admin/users/${encodeURIComponent(nickname)}/roles`, {
      method: "PATCH",
      body: JSON.stringify({ is_admin: isAdmin }),
    }),
  createTab: (title: string, audience: Audience) =>
    request<FormTab>("/api/admin/tabs", {
      method: "POST",
      body: JSON.stringify({ title, audience }),
    }),
  deleteTab: (id: string) =>
    request<{ deleted: boolean }>(`/api/admin/tabs/${id}`, { method: "DELETE" }),
  createForm: (payload: Omit<FormItem, "id">) =>
    request<FormItem>("/api/admin/forms", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteForm: (id: string) =>
    request<{ deleted: boolean }>(`/api/admin/forms/${id}`, { method: "DELETE" }),
  createDocsSection: (title: string, audience: Audience) =>
    request<DocsSection>("/api/admin/docs-sections", {
      method: "POST",
      body: JSON.stringify({ title, audience }),
    }),
  deleteDocsSection: (id: string) =>
    request<{ deleted: boolean }>(`/api/admin/docs-sections/${id}`, { method: "DELETE" }),
  createDoc: (payload: Omit<DocItem, "id">) =>
    request<DocItem>("/api/admin/docs", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateDoc: (id: string, payload: Omit<DocItem, "id">) =>
    request<DocItem>(`/api/admin/docs/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteDoc: (id: string) =>
    request<{ deleted: boolean }>(`/api/admin/docs/${id}`, { method: "DELETE" }),
  uploadImage: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return uploadRequest<{ url: string }>("/api/admin/uploads/image", body);
  },
};
