import { useState, useEffect, useCallback } from "react";
import { api, type AdminLog } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  Search,
  RefreshCw,
  ArrowLeft,
  Filter,
  Shield,
  UserCheck,
  UserX,
  KeyRound,
  CalendarPlus,
  Power,
  Clock,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

const ACTION_FILTERS = [
  { value: "all", label: "All Actions" },
  { value: "role_change", label: "Role Changes" },
  { value: "user_approve", label: "Approvals" },
  { value: "user_ban", label: "Bans" },
  { value: "alias_activate", label: "Activations" },
  { value: "alias_deactivate", label: "Deactivations" },
  { value: "alias_extend", label: "Extensions" },
  { value: "password_reset", label: "Password Resets" },
];

const actionIcons: Record<string, typeof Shield> = {
  role_change: Shield,
  user_approve: UserCheck,
  user_ban: UserX,
  user_pending: Clock,
  alias_activate: Power,
  alias_deactivate: Power,
  alias_extend: CalendarPlus,
  password_reset: KeyRound,
};

const actionColors: Record<string, string> = {
  role_change: "text-amber-500",
  user_approve: "text-green-500",
  user_ban: "text-red-500",
  user_pending: "text-amber-500",
  alias_activate: "text-green-500",
  alias_deactivate: "text-red-500",
  alias_extend: "text-blue-500",
  password_reset: "text-purple-500",
};

export default function AdminLogs() {
  const navigate = useNavigate();
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.adminLogs({
        action: actionFilter !== "all" ? actionFilter : undefined,
        search: search || undefined,
      });
      setLogs(res.logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load logs");
    } finally {
      setLoading(false);
    }
  }, [actionFilter, search]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return d.toLocaleDateString();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b px-3 sm:px-4 py-3 space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => navigate("/admin")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold flex-1">Activity Logs</h1>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={fetchLogs}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search logs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 h-9 shrink-0">
                <Filter className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{ACTION_FILTERS.find((f) => f.value === actionFilter)?.label}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {ACTION_FILTERS.map((f) => (
                <DropdownMenuItem key={f.value} onClick={() => setActionFilter(f.value)} className={cn(actionFilter === f.value && "bg-accent")}>
                  {f.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {error && !loading ? (
          <div className="flex flex-col items-center justify-center py-20 px-4">
            <p className="text-destructive mb-4">{error}</p>
            <Button variant="outline" onClick={fetchLogs}><RefreshCw className="h-4 w-4 mr-2" /> Retry</Button>
          </div>
        ) : loading ? (
          <div className="divide-y">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 p-3 sm:p-4">
                <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-3 w-12" />
              </div>
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Clock className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">No activity logs yet</p>
          </div>
        ) : (
          <div className="divide-y">
            {logs.map((log, i) => {
              const IconComp = actionIcons[log.action] || Shield;
              const color = actionColors[log.action] || "text-muted-foreground";

              return (
                <div key={i} className="flex items-start gap-3 p-3 sm:p-4">
                  <div className={cn("p-1.5 rounded-full bg-muted shrink-0", color)}>
                    <IconComp className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{log.adminName}</span>
                      <Badge variant="outline" className="text-[10px]">{log.action.replace(/_/g, " ")}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {log.targetType}: <span className="font-mono">{log.targetId}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{log.details}</p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                    {formatTime(log.timestamp)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
