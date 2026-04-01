import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTheme } from "@/contexts/theme-context";
import { Shield, Eye, EyeOff, Sun, Moon, Monitor, ArrowRight, Lock, AlertCircle, Mail, KeyRound } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function AdminLoginPage() {
  const { refreshUser } = useAuth();
  const { theme, setTheme } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [adminKey, setAdminKey] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showAdminKey, setShowAdminKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { setError("Admin email is required"); return; }
    if (!password.trim()) { setError("Password is required"); return; }
    setLoading(true);
    setError("");
    try {
      await api.adminLogin(email.trim(), password, adminKey || undefined);
      await refreshUser();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          setError(err.message || "Access denied. Admin privileges required.");
        } else if (err.status === 401) {
          setError("Invalid credentials. Check your email and password.");
        } else if (err.status === 429) {
          setError("Too many attempts. Please wait and try again.");
        } else {
          setError(err.message || "Login failed.");
        }
      } else if (err instanceof TypeError) {
        setError("Cannot connect to server.");
      } else {
        setError("Login failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const themes = [
    { value: "light" as const, label: "Light", icon: Sun },
    { value: "dark" as const, label: "Dark", icon: Moon },
    { value: "system" as const, label: "System", icon: Monitor },
  ];
  const currentTheme = themes.find((t) => t.value === theme) || themes[2];
  const CurrentIcon = currentTheme.icon;

  return (
    <div className="min-h-screen flex flex-col bg-background relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,hsl(var(--destructive)/0.08),transparent_50%),radial-gradient(ellipse_at_bottom_right,hsl(var(--primary)/0.06),transparent_50%)]" />
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-destructive/30 to-transparent" />

      <div className="flex items-center justify-between px-5 py-4 relative z-10">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-red-600 to-red-500 text-white shadow-md shadow-red-500/20">
            <Shield className="h-[18px] w-[18px]" />
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-sm tracking-tight">ZayMail</span>
            <span className="text-[9px] uppercase tracking-[0.15em] font-semibold text-red-500">Admin Console</span>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-accent border border-transparent hover:border-border/50 transition-all duration-200">
              <CurrentIcon className="h-4 w-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {themes.map(({ value, label, icon: Icon }) => (
              <DropdownMenuItem key={value} onClick={() => setTheme(value)} className={theme === value ? "bg-accent font-medium" : ""}>
                <Icon className="h-4 w-4 mr-2" /> {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 relative z-10">
        <div className="w-full max-w-[400px] space-y-7">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-red-600 to-red-500 text-white shadow-xl shadow-red-500/25 mb-2">
              <Shield className="h-8 w-8" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Admin Access</h1>
            <p className="text-muted-foreground text-sm">Authorized personnel only</p>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-center">
            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
              This area is restricted to system administrators.
              Unauthorized access attempts are logged and monitored.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="flex items-start gap-3 p-4 text-sm bg-destructive/10 text-destructive rounded-xl border border-destructive/20 animate-in fade-in slide-in-from-top-1 duration-300">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span className="leading-snug">{error}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="admin-email" className="text-sm font-medium">Admin Email</Label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
                <Input
                  id="admin-email"
                  type="email"
                  placeholder="admin@zayvex.cloud"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(""); }}
                  autoComplete="email"
                  required
                  autoFocus
                  className="h-11 pl-10 rounded-xl bg-card border-border/60 focus:border-red-500/50 transition-colors"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="admin-password" className="text-sm font-medium">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
                <Input
                  id="admin-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Your web password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(""); }}
                  autoComplete="current-password"
                  required
                  className="h-11 pl-10 pr-11 rounded-xl bg-card border-border/60 focus:border-red-500/50 transition-colors"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground transition-colors" tabIndex={-1}>
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="admin-key" className="text-sm font-medium">
                Admin Secret Key <span className="text-muted-foreground font-normal">(if configured)</span>
              </Label>
              <div className="relative">
                <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
                <Input
                  id="admin-key"
                  type={showAdminKey ? "text" : "password"}
                  placeholder="Optional admin access key"
                  value={adminKey}
                  onChange={(e) => { setAdminKey(e.target.value); setError(""); }}
                  className="h-11 pl-10 pr-11 rounded-xl bg-card border-border/60 focus:border-red-500/50 transition-colors"
                />
                <button type="button" onClick={() => setShowAdminKey(!showAdminKey)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground transition-colors" tabIndex={-1}>
                  {showAdminKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-11 rounded-xl text-sm font-semibold bg-gradient-to-r from-red-600 to-red-500 hover:from-red-700 hover:to-red-600 shadow-md shadow-red-500/20 hover:shadow-lg hover:shadow-red-500/30 transition-all duration-200"
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Authenticating...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  Access Admin Panel
                  <ArrowRight className="h-4 w-4" />
                </span>
              )}
            </Button>
          </form>

          <div className="text-center">
            <a href="/" className="text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors underline-offset-4 hover:underline">
              Back to user login
            </a>
          </div>
        </div>
      </div>

      <footer className="relative z-10 py-3 text-center">
        <p className="text-[10px] text-muted-foreground/50">
          ZayMail Admin Console — Developed by{" "}
          <a href="https://t.me/N2X4E" target="_blank" rel="noopener noreferrer" className="text-muted-foreground/70 hover:text-foreground transition-colors">
            NiHAL
          </a>
        </p>
      </footer>
    </div>
  );
}
