const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${BASE}/api${path}`;
  const res = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      (body as Record<string, string>).error || res.statusText,
      res.status
    );
  }

  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface Alias {
  email: string;
  active: boolean;
  expiresAt?: string;
  dbKey: string;
  dbLabel?: string;
  hasPassword?: boolean;
  createdAt?: string;
}

export interface User {
  email: string;
  tgUserId: number;
  dbKey: string;
  aliases: Alias[];
}

export interface LoginResponse {
  success: boolean;
  user: User;
}

export interface MailSummary {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  read: boolean;
  starred: boolean;
  aliasEmail: string;
}

export interface InboxResponse {
  mails: MailSummary[];
  total: number;
  unreadCount: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface MailDetail {
  id: string;
  from: string;
  subject: string;
  body: string;
  snippet: string;
  receivedAt: string;
  read: boolean;
  starred: boolean;
  deleted: boolean;
  aliasEmail: string;
  dateHeader: string;
  bot: string;
}

export interface InboxStats {
  total: number;
  unread: number;
  starred: number;
}

export const api = {
  login(email: string, password: string) {
    return request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  logout() {
    return request<{ success: boolean }>("/auth/logout", { method: "POST" });
  },

  me() {
    return request<User>("/auth/me");
  },

  switchAccount(email: string) {
    return request<{ success: boolean; email: string; dbKey: string }>(
      "/auth/switch",
      {
        method: "POST",
        body: JSON.stringify({ email }),
      }
    );
  },

  inbox(params: {
    page?: number;
    limit?: number;
    search?: string;
    filter?: string;
  }) {
    const q = new URLSearchParams();
    if (params.page !== undefined) q.set("page", String(params.page));
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    if (params.search) q.set("search", params.search);
    if (params.filter) q.set("filter", params.filter);
    return request<InboxResponse>(`/inbox?${q.toString()}`);
  },

  inboxStats() {
    return request<InboxStats>("/inbox/stats");
  },

  mail(id: string) {
    return request<MailDetail>(`/mail/${encodeURIComponent(id)}`);
  },

  patchMail(id: string, patch: { read?: boolean; starred?: boolean; deleted?: boolean }) {
    return request<{ success: boolean }>(`/mail/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },

  batchMail(ids: string[], action: "read" | "unread" | "star" | "unstar" | "delete") {
    return request<{ success: boolean; modified: number }>("/mail/batch", {
      method: "POST",
      body: JSON.stringify({ ids, action }),
    });
  },

  aliases() {
    return request<{ aliases: Alias[] }>("/aliases");
  },

  changePassword(email: string, currentPassword: string, newPassword: string) {
    return request<{ success: boolean }>(
      `/aliases/${encodeURIComponent(email)}/password`,
      {
        method: "PATCH",
        body: JSON.stringify({ currentPassword, newPassword }),
      }
    );
  },
};
