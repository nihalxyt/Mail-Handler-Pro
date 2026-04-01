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
  ScrollText,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

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
  role_change: "text-violet-500 bg-violet-500/10",
  user_approve: "text-emerald-500 bg-emerald-500/10",
  user_ban: "text-red-500 bg-red-500/10",
  user_pending: "text-amber-500 bg-amber-500/10",
  alias_activate: "text-emerald-500 bg-emerald-500/10",
  alias_deactivate: "text-red-500 bg-red-500/10",
  alias_extend: "text-blue-500 bg-blue-500/10",
  password_reset: "text-violet-500 bg-violet-500/10",
};

export default function AdminLogs() {
  const navigate = useNavigate();
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.adminLogs({
        action: actionFilter !== "all" ? actionFilter : undefined,
        search: search || undefined,
      });
      setLogs(res.logs);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load logs");
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
      <div className="sticky top-0 z-10 bg-background/80 glass border-b px-3 sm:px-4 py-3 space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-xl" onClick={() => navigate("/admin")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold flex-1">Activity Logs</h1>
          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl" onClick={fetchLogs}>
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
              className="pl-9 h-9 rounded-xl"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 h-9 shrink-0 rounded-xl">
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

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {loading ? (
          <div className="divide-y">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 p-3 sm:p-4 animate-in fade-in duration-300" style={{ animationDelay: `${i * 50}ms`, animationFillMode: "both" }}>
                <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-3 w-12" />
              </div>
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in slide-in-from-bottom-4 duration-400">
            <ScrollText className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">No activity logs yet</p>
          </div>
        ) : (
          <div className="divide-y">
            {logs.map((log, i) => {
              const IconComp = actionIcons[log.action] || Shield;
              const colorClasses = actionColors[log.action] || "text-muted-foreground bg-muted";

              return (
                <div
                  key={i}
                  className="flex items-start gap-3 p-3 sm:p-4 hover:bg-accent/20 transition-colors animate-in fade-in slide-in-from-bottom-2"
                  style={{ animationDelay: `${Math.min(i * 30, 300)}ms`, animationFillMode: "both" }}
                >
                  <div className={cn("p-2 rounded-lg shrink-0", colorClasses)}>
                    <IconComp className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium">{log.adminName}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5">{log.action.replace(/_/g, " ")}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {log.targetType}: <span className="font-mono text-xs">{log.targetId}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{log.details}</p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap tabular-nums">
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
