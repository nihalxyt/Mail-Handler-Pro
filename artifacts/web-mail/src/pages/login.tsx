import { useState, useEffect, type FormEvent } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTheme } from "@/contexts/theme-context";
import { Mail, Eye, EyeOff, Sun, Moon, Monitor, ArrowRight, Lock, AlertCircle, CheckCircle2 } from "lucide-react";
import DevFooter from "@/components/dev-footer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function LoginPage() {
  const { login } = useAuth();
  const { theme, setTheme } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (!shake) return;
    const timer = setTimeout(() => setShake(false), 600);
    return () => clearTimeout(timer);
  }, [shake]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError("Please enter your email address");
      setShake(true);
      return;
    }
    if (!password.trim()) {
      setError("Please enter your password");
      setShake(true);
      return;
    }
    setLoading(true);
    setError("");
    try {
      await login(email.trim(), password);
      setSuccess(true);
    } catch (err) {
      setShake(true);
      if (err && typeof err === "object" && "message" in err) {
        const apiErr = err as { status?: number; message: string };
        const status = apiErr.status || 0;
        const msg = apiErr.message || "";
        if (status === 401) {
          setError(msg || "Invalid email or password.");
        } else if (status === 400) {
          setError(msg || "Please check your input and try again.");
        } else if (status === 403) {
          setError(msg || "This account is not accessible.");
        } else if (status === 429) {
          setError("Too many attempts. Please wait and try again.");
        } else if (status >= 500) {
          setError("Server error. Please try again later.");
        } else {
          setError(msg || "Login failed. Please try again.");
        }
      } else if (err instanceof TypeError) {
        setError("Cannot connect to server. Please check your connection.");
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

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center animate-in fade-in zoom-in-95 duration-500">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-emerald-500/10 mb-4 animate-in zoom-in duration-300">
            <CheckCircle2 className="h-10 w-10 text-emerald-500 animate-in spin-in-180 duration-500" />
          </div>
          <h2 className="text-xl font-bold mb-1 animate-in fade-in slide-in-from-bottom-2 duration-400" style={{ animationDelay: "200ms", animationFillMode: "both" }}>
            Welcome back!
          </h2>
          <p className="text-sm text-muted-foreground animate-in fade-in slide-in-from-bottom-2 duration-400" style={{ animationDelay: "350ms", animationFillMode: "both" }}>
            Loading your mailbox...
          </p>
          <div className="mt-4 animate-in fade-in duration-400" style={{ animationDelay: "500ms", animationFillMode: "both" }}>
            <div className="h-1 w-32 mx-auto bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full animate-pulse" style={{ width: "70%" }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,hsl(var(--primary)/0.12),transparent_50%),radial-gradient(ellipse_at_bottom_right,hsl(var(--primary)/0.08),transparent_50%)]" />
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />

      <div className="flex items-center justify-between px-5 py-4 relative z-10">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/20">
            <Mail className="h-[18px] w-[18px]" />
          </div>
          <span className="font-bold text-base tracking-tight">ZayMail</span>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-accent border border-transparent hover:border-border/50 transition-all duration-200">
              <CurrentIcon className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground hidden sm:inline">{currentTheme.label}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {themes.map(({ value, label, icon: Icon }) => (
              <DropdownMenuItem
                key={value}
                onClick={() => setTheme(value)}
                className={theme === value ? "bg-accent font-medium" : ""}
              >
                <Icon className="h-4 w-4 mr-2" />
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 relative z-10">
        <div className={`w-full max-w-[380px] space-y-8 transition-transform duration-300 ${shake ? "animate-[shake_0.5s_ease-in-out]" : ""}`}>
          <div className="text-center space-y-2 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-xl shadow-primary/25 mb-2">
              <Mail className="h-8 w-8" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Welcome back</h1>
            <p className="text-muted-foreground text-sm">Sign in to access your mailbox</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500" style={{ animationDelay: "100ms", animationFillMode: "both" }}>
            {error && (
              <div className="flex items-start gap-3 p-4 text-sm bg-destructive/10 text-destructive rounded-xl border border-destructive/20 animate-in fade-in slide-in-from-top-1 duration-300">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span className="leading-snug">{error}</span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">Email address</Label>
              <div className="relative group">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 group-focus-within:text-primary/70 transition-colors" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(""); }}
                  autoComplete="email"
                  required
                  autoFocus
                  className="h-12 pl-10 rounded-xl bg-card border-border/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all duration-200"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium">Password</Label>
              <div className="relative group">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 group-focus-within:text-primary/70 transition-colors" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Your web password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(""); }}
                  autoComplete="current-password"
                  required
                  className="h-12 pl-10 pr-11 rounded-xl bg-card border-border/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all duration-200"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-12 rounded-xl text-sm font-semibold shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 transition-all duration-200 active:scale-[0.98]"
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Signing in...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  Sign in
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              )}
            </Button>
          </form>

          <div className="text-center animate-in fade-in slide-in-from-bottom-4 duration-500" style={{ animationDelay: "200ms", animationFillMode: "both" }}>
            <p className="text-xs text-muted-foreground/70">
              Get your login password from the Telegram bot.
              <br />Your connection is encrypted and secure.
            </p>
          </div>
        </div>
      </div>

      <footer className="relative z-10">
        <DevFooter variant="login" />
      </footer>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
          20%, 40%, 60%, 80% { transform: translateX(4px); }
        }
      `}</style>
    </div>
  );
}
