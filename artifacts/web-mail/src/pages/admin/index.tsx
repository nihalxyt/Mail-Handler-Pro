import { useState, useEffect } from "react";
import { api, type DashboardStats } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Mail, AtSign, TrendingUp, Shield, Clock } from "lucide-react";

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color,
}: {
  title: string;
  value: number;
  subtitle?: string;
  icon: typeof Users;
  color: string;
}) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
            <p className="text-2xl font-bold mt-1">{value.toLocaleString()}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          <div className={`p-2.5 rounded-xl ${color}`}>
            <Icon className="h-5 w-5 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Record<string, DashboardStats> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .adminDashboard()
      .then((r) => setStats(r.stats))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
          <Shield className="h-8 w-8 text-destructive" />
        </div>
        <h3 className="text-lg font-semibold mb-1">Access Denied</h3>
        <p className="text-sm text-muted-foreground max-w-xs">{error}</p>
      </div>
    );
  }

  const totals = {
    users: 0,
    activeUsers: 0,
    pendingUsers: 0,
    bannedUsers: 0,
    aliases: 0,
    activeAliases: 0,
    mails: 0,
    unreadMails: 0,
    last24h: 0,
  };

  if (stats) {
    for (const s of Object.values(stats)) {
      totals.users += s.users.total;
      totals.activeUsers += s.users.active;
      totals.pendingUsers += s.users.pending;
      totals.bannedUsers += s.users.banned;
      totals.aliases += s.aliases.total;
      totals.activeAliases += s.aliases.active;
      totals.mails += s.mails.total;
      totals.unreadMails += s.mails.unread;
      totals.last24h += s.mails.last24h;
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">System overview and statistics</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <StatCard
          title="Total Users"
          value={totals.users}
          subtitle={`${totals.activeUsers} active`}
          icon={Users}
          color="bg-blue-500"
        />
        <StatCard
          title="Pending"
          value={totals.pendingUsers}
          icon={Clock}
          color="bg-amber-500"
        />
        <StatCard
          title="Aliases"
          value={totals.aliases}
          subtitle={`${totals.activeAliases} active`}
          icon={AtSign}
          color="bg-emerald-500"
        />
        <StatCard
          title="Total Mails"
          value={totals.mails}
          subtitle={`${totals.unreadMails} unread`}
          icon={Mail}
          color="bg-violet-500"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Activity (Last 24h)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-muted rounded-full h-3 overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{
                  width: totals.mails > 0 ? `${Math.min(100, (totals.last24h / Math.max(totals.mails, 1)) * 100)}%` : "0%",
                }}
              />
            </div>
            <span className="text-sm font-medium tabular-nums">{totals.last24h}</span>
            <span className="text-xs text-muted-foreground">new emails</span>
          </div>
        </CardContent>
      </Card>

      {stats && Object.entries(stats).length > 1 && (
        <div className="grid md:grid-cols-2 gap-4">
          {Object.entries(stats).map(([key, s]) => (
            <Card key={key}>
              <CardHeader>
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-primary" />
                  {key === "bot1" ? "Bot 1" : "Bot 2"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Users</span>
                  <span className="font-medium">{s.users.total} ({s.users.active} active)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Aliases</span>
                  <span className="font-medium">{s.aliases.total} ({s.aliases.active} active)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Emails</span>
                  <span className="font-medium">{s.mails.total} ({s.mails.unread} unread)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last 24h</span>
                  <span className="font-medium">{s.mails.last24h}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
