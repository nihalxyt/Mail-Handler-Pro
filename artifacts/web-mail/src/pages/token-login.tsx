import { useState, useEffect, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/auth-context";
import { api } from "@/lib/api";
import { Mail, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import DevFooter from "@/components/dev-footer";

type Stage = "validating" | "success" | "error";

export default function TokenLoginPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [stage, setStage] = useState<Stage>("validating");
  const [errorMsg, setErrorMsg] = useState("");
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    const token = searchParams.get("t");
    if (!token) {
      setStage("error");
      setErrorMsg("No login token provided. Please request a new link from the bot.");
      return;
    }

    (async () => {
      try {
        const result = await api.tokenLogin(token);
        setStage("success");

        await refreshUser();

        setTimeout(() => {
          if (result.type === "admin") {
            navigate("/admin", { replace: true });
          } else {
            navigate("/", { replace: true });
          }
        }, 1200);
      } catch (err) {
        setStage("error");
        if (err && typeof err === "object" && "message" in err) {
          setErrorMsg((err as { message: string }).message);
        } else {
          setErrorMsg("Login failed. The link may be expired or invalid.");
        }
      }
    })();
  }, [searchParams, navigate, refreshUser]);

  return (
    <div className="min-h-screen flex flex-col bg-background relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,hsl(var(--primary)/0.12),transparent_50%),radial-gradient(ellipse_at_bottom_right,hsl(var(--primary)/0.08),transparent_50%)]" />

      <div className="flex items-center px-5 py-4 relative z-10">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/20">
            <Mail className="h-[18px] w-[18px]" />
          </div>
          <span className="font-bold text-base tracking-tight">ZayMail</span>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 relative z-10">
        {stage === "validating" && (
          <div className="text-center animate-in fade-in zoom-in-95 duration-500">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/10 mb-4">
              <Loader2 className="h-10 w-10 text-primary animate-spin" />
            </div>
            <h2 className="text-xl font-bold mb-1">Signing you in...</h2>
            <p className="text-sm text-muted-foreground">Validating your login link</p>
          </div>
        )}

        {stage === "success" && (
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
        )}

        {stage === "error" && (
          <div className="text-center max-w-sm animate-in fade-in zoom-in-95 duration-500">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-destructive/10 mb-4">
              <AlertCircle className="h-10 w-10 text-destructive" />
            </div>
            <h2 className="text-xl font-bold mb-2">Login Failed</h2>
            <p className="text-sm text-muted-foreground mb-6">{errorMsg}</p>
            <a
              href="/"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 transition-all duration-200"
            >
              Go to Login Page
            </a>
          </div>
        )}
      </div>

      <footer className="relative z-10">
        <DevFooter variant="login" />
      </footer>
    </div>
  );
}
