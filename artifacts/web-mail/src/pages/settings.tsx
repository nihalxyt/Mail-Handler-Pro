import { useState, useEffect, type FormEvent } from "react";
import { api, type Alias, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/auth-context";
import { useTheme } from "@/contexts/theme-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Sun,
  Moon,
  Monitor,
  LogOut,
  Key,
  Eye,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAlias, setSelectedAlias] = useState<string | null>(null);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMessage, setPwMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    api
      .aliases()
      .then((r) => setAliases(r.aliases))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handlePasswordChange = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedAlias || !newPw) return;
    if (newPw.length < 6) {
      setPwMessage({ type: "error", text: "Password must be at least 6 characters" });
      return;
    }
    if (newPw !== confirmPw) {
      setPwMessage({ type: "error", text: "Passwords do not match" });
      return;
    }

    setPwLoading(true);
    setPwMessage(null);
    try {
      await api.changePassword(selectedAlias, currentPw, newPw);
      setPwMessage({ type: "success", text: "Password changed successfully!" });
      toast.success("Password changed successfully");
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (err) {
      setPwMessage({
        type: "error",
        text: err instanceof ApiError ? err.message : "Failed to change password",
      });
    } finally {
      setPwLoading(false);
    }
  };

  const themes = [
    { value: "light" as const, label: "Light", icon: Sun },
    { value: "dark" as const, label: "Dark", icon: Moon },
    { value: "system" as const, label: "System", icon: Monitor },
  ];

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-6 overflow-y-auto h-full scrollbar-thin">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your preferences and security
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Appearance</CardTitle>
          <CardDescription>Choose your preferred theme</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {themes.map(({ value, label, icon: Icon }) => (
              <Button
                key={value}
                variant={theme === value ? "default" : "outline"}
                size="sm"
                onClick={() => setTheme(value)}
                className="gap-2"
              >
                <Icon className="h-4 w-4" />
                {label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Key className="h-4 w-4" />
            Change Password
          </CardTitle>
          <CardDescription>Update the web login password for your email aliases</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-10 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          ) : aliases.length === 0 ? (
            <p className="text-sm text-muted-foreground">No aliases found</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {aliases.map((a) => (
                  <button
                    key={a.email}
                    onClick={() => {
                      setSelectedAlias(a.email === selectedAlias ? null : a.email);
                      setPwMessage(null);
                      setCurrentPw("");
                      setNewPw("");
                      setConfirmPw("");
                    }}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                      selectedAlias === a.email
                        ? "border-primary bg-primary/5"
                        : "hover:bg-accent"
                    }`}
                  >
                    <span className="truncate max-w-[200px]">{a.email}</span>
                    <Badge variant={a.active ? "default" : "secondary"} className="text-[10px] px-1.5">
                      {a.active ? "Active" : "Inactive"}
                    </Badge>
                  </button>
                ))}
              </div>

              {selectedAlias && (
                <>
                  <Separator />
                  <form onSubmit={handlePasswordChange} className="space-y-3">
                    {pwMessage && (
                      <div
                        className={`flex items-center gap-2 p-3 text-sm rounded-lg border ${
                          pwMessage.type === "success"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800"
                            : "bg-destructive/10 text-destructive border-destructive/20"
                        }`}
                      >
                        <div className={`h-4 w-4 rounded-full shrink-0 ${pwMessage.type === "success" ? "bg-emerald-500" : "bg-destructive"}`} />
                        {pwMessage.text}
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <Label htmlFor="current-pw" className="text-xs">
                        Current Password
                      </Label>
                      <div className="relative">
                        <Input
                          id="current-pw"
                          type={showCurrentPw ? "text" : "password"}
                          value={currentPw}
                          onChange={(e) => setCurrentPw(e.target.value)}
                          placeholder="Current password"
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowCurrentPw(!showCurrentPw)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                          tabIndex={-1}
                        >
                          {showCurrentPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="new-pw" className="text-xs">
                        New Password
                      </Label>
                      <div className="relative">
                        <Input
                          id="new-pw"
                          type={showNewPw ? "text" : "password"}
                          value={newPw}
                          onChange={(e) => setNewPw(e.target.value)}
                          placeholder="New password (min 6 chars)"
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPw(!showNewPw)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                          tabIndex={-1}
                        >
                          {showNewPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="confirm-pw" className="text-xs">
                        Confirm New Password
                      </Label>
                      <Input
                        id="confirm-pw"
                        type="password"
                        value={confirmPw}
                        onChange={(e) => setConfirmPw(e.target.value)}
                        placeholder="Confirm new password"
                      />
                    </div>
                    <Button type="submit" size="sm" disabled={pwLoading || !newPw}>
                      {pwLoading ? "Changing..." : "Change Password"}
                    </Button>
                  </form>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
          <CardDescription>
            Signed in as <span className="font-medium text-foreground">{user?.email}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={logout}
            className="gap-2 text-destructive hover:text-destructive"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
