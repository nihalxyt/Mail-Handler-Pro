import { useState, useEffect } from "react";
import { api, type DashboardStats } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
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
} from "lucide-react";

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
      <div className="p-4 sm:p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4">
        <p className="text-destructive mb-4">{error}</p>
        <Button variant="outline" onClick={fetchStats}>
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
    { label: "Total Users", value: totals.users.total, icon: Users, color: "text-blue-500" },
    { label: "Active Users", value: totals.users.active, icon: UserCheck, color: "text-green-500" },
    { label: "Pending", value: totals.users.pending, icon: Clock, color: "text-amber-500" },
    { label: "Banned", value: totals.users.banned, icon: UserX, color: "text-red-500" },
    { label: "Total Aliases", value: totals.aliases.total, icon: AtSign, color: "text-purple-500" },
    { label: "Active Aliases", value: totals.aliases.active, icon: ShieldCheck, color: "text-emerald-500" },
    { label: "Total Emails", value: totals.mails.total, icon: Mail, color: "text-indigo-500" },
    { label: "Last 24h", value: totals.mails.last24h, icon: Clock, color: "text-cyan-500" },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold">Admin Dashboard</h1>
        <Button variant="ghost" size="icon" onClick={fetchStats}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="pt-4 pb-4 px-4">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg bg-muted ${c.color}`}>
                  <c.icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{c.value.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {Object.entries(stats || {}).length > 1 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Per-Bot Breakdown</h2>
          <div className="grid md:grid-cols-2 gap-4">
            {Object.entries(stats || {}).map(([key, s]) => (
              <Card key={key}>
                <CardContent className="pt-4 pb-4 px-4">
                  <h3 className="font-semibold mb-3 text-sm uppercase tracking-wide text-muted-foreground">
                    {key === "bot1" ? "Bot 1" : "Bot 2"}
                  </h3>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="font-medium">{s.users.active}/{s.users.total}</p>
                      <p className="text-xs text-muted-foreground">Users</p>
                    </div>
                    <div>
                      <p className="font-medium">{s.aliases.active}/{s.aliases.total}</p>
                      <p className="text-xs text-muted-foreground">Aliases</p>
                    </div>
                    <div>
                      <p className="font-medium">{s.mails.last24h}</p>
                      <p className="text-xs text-muted-foreground">24h Mails</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-3">
        <Button variant="outline" className="justify-start gap-2" onClick={() => navigate("/admin/users")}>
          <Users className="h-4 w-4" /> Manage Users
        </Button>
        <Button variant="outline" className="justify-start gap-2" onClick={() => navigate("/admin/aliases")}>
          <AtSign className="h-4 w-4" /> Manage Aliases
        </Button>
        <Button variant="outline" className="justify-start gap-2" onClick={() => navigate("/admin/logs")}>
          <Clock className="h-4 w-4" /> Activity Logs
        </Button>
      </div>
    </div>
  );
}
