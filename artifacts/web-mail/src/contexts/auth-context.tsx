import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { api, type User, ApiError } from "@/lib/api";

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  adminLogin: (email: string, password: string, adminKey?: string) => Promise<void>;
  logout: () => Promise<void>;
  switchAccount: (email: string) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    error: null,
  });

  const refreshUser = useCallback(async () => {
    try {
      const user = await api.me();
      setState({ user, loading: false, error: null });
    } catch {
      setState({ user: null, loading: false, error: null });
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await api.login(email, password);
      setState({ user: res.user, loading: false, error: null });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Login failed";
      setState({ user: null, loading: false, error: msg });
      throw err;
    }
  }, []);

  const adminLogin = useCallback(async (email: string, password: string, adminKey?: string) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await api.adminLogin(email, password, adminKey);
      setState({ user: res.user, loading: false, error: null });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Admin login failed";
      setState({ user: null, loading: false, error: msg });
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setState({ user: null, loading: false, error: null });
    }
  }, []);

  const switchAccount = useCallback(async (email: string) => {
    try {
      await api.switchAccount(email);
      await refreshUser();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Switch failed";
      setState((s) => ({ ...s, error: msg }));
      throw err;
    }
  }, [refreshUser]);

  return (
    <AuthContext.Provider value={{ ...state, login, adminLogin, logout, switchAccount, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
