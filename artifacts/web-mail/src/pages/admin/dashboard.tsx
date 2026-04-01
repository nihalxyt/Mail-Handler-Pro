import { useState, useEffect } from "react";
import { api, type DashboardStats } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import {
  Users,
  Mail,
  AtSign,
  Clock,
  ShieldCheck,
  UserX,
  UserCheck,
  RefreshCw,
  TrendingUp,
  ArrowRight,
} from "lucide-react";

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
  bg,
  index,
}: {
  label: string;
  value: number;
  sub?: string;
  icon: typeof Users;
  color: string;
  bg: string;
  index: number;
}) {
  return (
    <Card
      className="relative overflow-hidden group hover:shadow-md transition-all duration-200 animate-in fade-in slide-in-from-bottom-3"
      style={{ animationDelay: `${index * 60}ms`, animationFillMode: "both" }}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
            <p className="text-2xl font-bold mt-1 tabular-nums">{value.toLocaleString()}</p>
            {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className={`p-2.5 rounded-xl ${bg} transition-transform duration-200 group-hover:scale-110`}>
            <Icon className={`h-5 w-5 ${color}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<Record<string, DashboardStats> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchStats = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.adminDashboard();
      setStats(res.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl animate-in fade-in duration-300" style={{ animationDelay: `${i * 50}ms`, animationFillMode: "both" }} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 animate-in fade-in slide-in-from-bottom-4 duration-400">
        <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center mb-4">
          <ShieldCheck className="h-8 w-8 text-destructive" />
        </div>
        <h3 className="text-lg font-semibold mb-1">Dashboard Error</h3>
        <p className="text-sm text-muted-foreground mb-4">{error}</p>
        <Button variant="outline" onClick={fetchStats} className="rounded-xl">
          <RefreshCw className="h-4 w-4 mr-2" /> Retry
        </Button>
      </div>
    );
  }

  const totals = Object.values(stats || {}).reduce(
    (acc, s) => ({
      users: {
        total: acc.users.total + s.users.total,
        active: acc.users.active + s.users.active,
        pending: acc.users.pending + s.users.pending,
        banned: acc.users.banned + s.users.banned,
      },
      aliases: {
        total: acc.aliases.total + s.aliases.total,
        active: acc.aliases.active + s.aliases.active,
      },
      mails: {
        total: acc.mails.total + s.mails.total,
        unread: acc.mails.unread + s.mails.unread,
        last24h: acc.mails.last24h + s.mails.last24h,
      },
    }),
    {
      users: { total: 0, active: 0, pending: 0, banned: 0 },
      aliases: { total: 0, active: 0 },
      mails: { total: 0, unread: 0, last24h: 0 },
    }
  );

  const cards = [
    { label: "Total Users", value: totals.users.total, sub: `${totals.users.active} active`, icon: Users, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-100 dark:bg-blue-500/20" },
    { label: "Active Users", value: totals.users.active, icon: UserCheck, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-100 dark:bg-emerald-500/20" },
    { label: "Pending", value: totals.users.pending, icon: Clock, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-100 dark:bg-amber-500/20" },
    { label: "Banned", value: totals.users.banned, icon: UserX, color: "text-red-600 dark:text-red-400", bg: "bg-red-100 dark:bg-red-500/20" },
    { label: "Total Aliases", value: totals.aliases.total, sub: `${totals.aliases.active} active`, icon: AtSign, color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-100 dark:bg-violet-500/20" },
    { label: "Active Aliases", value: totals.aliases.active, icon: ShieldCheck, color: "text-teal-600 dark:text-teal-400", bg: "bg-teal-100 dark:bg-teal-500/20" },
    { label: "Total Emails", value: totals.mails.total, sub: `${totals.mails.unread} unread`, icon: Mail, color: "text-indigo-600 dark:text-indigo-400", bg: "bg-indigo-100 dark:bg-indigo-500/20" },
    { label: "Last 24h", value: totals.mails.last24h, icon: TrendingUp, color: "text-cyan-600 dark:text-cyan-400", bg: "bg-cyan-100 dark:bg-cyan-500/20" },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6 overflow-y-auto h-full scrollbar-thin">
      <div className="flex items-center justify-between animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Admin Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">System overview and management</p>
        </div>
        <Button variant="ghost" size="icon" onClick={fetchStats} className="h-9 w-9 rounded-xl">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {cards.map((c, i) => (
          <StatCard key={c.label} {...c} index={i} />
        ))}
      </div>

      {Object.entries(stats || {}).length > 1 && (
        <div className="space-y-3 animate-in fade-in slide-in-from-bottom-3 duration-400" style={{ animationDelay: "500ms", animationFillMode: "both" }}>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Per-Bot Breakdown</h2>
          <div className="grid md:grid-cols-2 gap-4">
            {Object.entries(stats || {}).map(([key, s], i) => (
              <Card key={key} className="animate-in fade-in slide-in-from-bottom-2 duration-300" style={{ animationDelay: `${550 + i * 80}ms`, animationFillMode: "both" }}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                    {key === "bot1" ? "Bot 1" : "Bot 2"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Users</span>
                    <span className="font-medium tabular-nums">{s.users.active}/{s.users.total}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Aliases</span>
                    <span className="font-medium tabular-nums">{s.aliases.active}/{s.aliases.total}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Emails</span>
                    <span className="font-medium tabular-nums">{s.mails.total} ({s.mails.unread} unread)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Last 24h</span>
                    <span className="font-medium tabular-nums">{s.mails.last24h}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-3 animate-in fade-in slide-in-from-bottom-3 duration-400" style={{ animationDelay: "700ms", animationFillMode: "both" }}>
        <Button variant="outline" className="justify-between gap-2 h-12 rounded-xl" onClick={() => navigate("/admin/users")}>
          <span className="flex items-center gap-2"><Users className="h-4 w-4" /> Manage Users</span>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </Button>
        <Button variant="outline" className="justify-between gap-2 h-12 rounded-xl" onClick={() => navigate("/admin/aliases")}>
          <span className="flex items-center gap-2"><AtSign className="h-4 w-4" /> Manage Aliases</span>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </Button>
        <Button variant="outline" className="justify-between gap-2 h-12 rounded-xl" onClick={() => navigate("/admin/logs")}>
          <span className="flex items-center gap-2"><Clock className="h-4 w-4" /> Activity Logs</span>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </Button>
      </div>
    </div>
  );
}
