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
  role?: string;
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

  adminCheck() {
    return request<{ isAdmin: boolean; role: string; name: string }>("/admin/check");
  },

  adminDashboard() {
    return request<{ stats: Record<string, DashboardStats> }>("/admin/dashboard");
  },

  adminUsers(params?: { status?: string; search?: string; page?: number }) {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.search) q.set("search", params.search);
    if (params?.page !== undefined) q.set("page", String(params.page));
    return request<{ users: AdminUser[]; total: number }>(`/admin/users?${q.toString()}`);
  },

  adminUserDetails(tgId: number, dbKey: string) {
    return request<AdminUserDetail>(`/admin/user/${tgId}/details?dbKey=${dbKey}`);
  },

  adminUpdateUserRole(tgId: number, role: string, dbKey: string) {
    return request<{ success: boolean }>(`/admin/users/${tgId}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role, dbKey }),
    });
  },

  adminUpdateUserStatus(tgId: number, status: string, dbKey: string) {
    return request<{ success: boolean }>(`/admin/users/${tgId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, dbKey }),
    });
  },

  adminAliases(params?: { search?: string; active?: string; page?: number }) {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.active) q.set("active", params.active);
    if (params?.page !== undefined) q.set("page", String(params.page));
    return request<{ aliases: AdminAlias[]; total: number }>(`/admin/aliases?${q.toString()}`);
  },

  adminToggleAlias(email: string, active: boolean, dbKey: string) {
    return request<{ success: boolean }>(`/admin/aliases/${encodeURIComponent(email)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ active, dbKey }),
    });
  },

  adminExtendAlias(email: string, days: number, dbKey: string) {
    return request<{ success: boolean; newExpiry: string }>(`/admin/aliases/${encodeURIComponent(email)}/extend`, {
      method: "PATCH",
      body: JSON.stringify({ days, dbKey }),
    });
  },

  adminResetPassword(email: string, dbKey: string) {
    return request<{ success: boolean; newPassword: string }>(`/admin/aliases/${encodeURIComponent(email)}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ dbKey }),
    });
  },

  adminLogs(params?: { action?: string; search?: string; page?: number }) {
    const q = new URLSearchParams();
    if (params?.action) q.set("action", params.action);
    if (params?.search) q.set("search", params.search);
    if (params?.page !== undefined) q.set("page", String(params.page));
    return request<{ logs: AdminLog[]; total: number }>(`/admin/logs?${q.toString()}`);
  },
};

export interface DashboardStats {
  users: { total: number; active: number; pending: number; banned: number };
  aliases: { total: number; active: number };
  mails: { total: number; unread: number; last24h: number };
}

export interface AdminUser {
  _id: string;
  tg_user_id: number;
  username: string;
  name: string;
  role: string;
  status: string;
  notifications: boolean;
  created_at: string;
  updated_at: string;
  stats: { total_mails: number; total_aliases: number };
  aliasCount: number;
  dbKey: string;
  dbLabel: string;
}

export interface AdminAlias {
  alias_email: string;
  tg_user_id: number;
  user_id: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  expires_at: string;
  hasPassword: boolean;
  ownerName: string;
  ownerStatus: string;
  dbKey: string;
  dbLabel: string;
}

export interface AdminLog {
  action: string;
  adminTgId: number;
  adminName: string;
  targetType: string;
  targetId: string;
  details: string;
  dbKey: string;
  timestamp: string;
}

export interface AdminUserDetail {
  user: AdminUser;
  aliases: (AdminAlias & { hasPassword: boolean })[];
  mailCount: number;
  recentMails: {
    id: string;
    from: string;
    subject: string;
    receivedAt: string;
    read: boolean;
    aliasEmail: string;
  }[];
}
