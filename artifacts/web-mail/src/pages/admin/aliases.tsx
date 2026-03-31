import { useState, useEffect, useCallback } from "react";
import { api, type AdminAlias } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  Search,
  MoreVertical,
  RefreshCw,
  ArrowLeft,
  Filter,
  Power,
  PowerOff,
  CalendarPlus,
  KeyRound,
  AtSign,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

const ACTIVE_FILTERS = [
  { value: "all", label: "All" },
  { value: "true", label: "Active" },
  { value: "false", label: "Inactive" },
];

export default function AdminAliases() {
  const navigate = useNavigate();
  const [aliases, setAliases] = useState<AdminAlias[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");

  const fetchAliases = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.adminAliases({
        search,
        active: activeFilter !== "all" ? activeFilter : undefined,
      });
      setAliases(res.aliases);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load aliases");
    } finally {
      setLoading(false);
    }
  }, [search, activeFilter]);

  useEffect(() => {
    fetchAliases();
  }, [fetchAliases]);

  const handleToggle = async (alias: AdminAlias) => {
    try {
      await api.adminToggleAlias(alias.alias_email, !alias.active, alias.dbKey);
      setAliases((prev) =>
        prev.map((a) =>
          a.alias_email === alias.alias_email && a.dbKey === alias.dbKey
            ? { ...a, active: !a.active }
            : a
        )
      );
      toast.success(`Alias ${!alias.active ? "activated" : "deactivated"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
      fetchAliases();
    }
  };

  const handleExtend = async (alias: AdminAlias, days: number) => {
    try {
      const res = await api.adminExtendAlias(alias.alias_email, days, alias.dbKey);
      setAliases((prev) =>
        prev.map((a) =>
          a.alias_email === alias.alias_email && a.dbKey === alias.dbKey
            ? { ...a, expires_at: res.newExpiry, active: true }
            : a
        )
      );
      toast.success(`Extended by ${days} days`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
      fetchAliases();
    }
  };

  const handleResetPassword = async (alias: AdminAlias) => {
    try {
      const res = await api.adminResetPassword(alias.alias_email, alias.dbKey);
      await navigator.clipboard.writeText(res.newPassword);
      toast.success("New password copied to clipboard", {
        description: res.newPassword,
        duration: 8000,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reset password");
    }
  };

  const isExpired = (expiresAt: string) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  const formatExpiry = (expiresAt: string) => {
    if (!expiresAt) return "No expiry";
    const d = new Date(expiresAt);
    const now = new Date();
    if (d < now) return "Expired";
    const diffDays = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 7) return `${diffDays}d left`;
    return d.toLocaleDateString();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-background/80 glass border-b px-3 sm:px-4 py-3 space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => navigate("/admin")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold flex-1">Alias Management</h1>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={fetchAliases}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search aliases..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 h-9 shrink-0">
                <Filter className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{ACTIVE_FILTERS.find((f) => f.value === activeFilter)?.label}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {ACTIVE_FILTERS.map((f) => (
                <DropdownMenuItem key={f.value} onClick={() => setActiveFilter(f.value)} className={cn(activeFilter === f.value && "bg-accent")}>
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
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3 sm:p-4">
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-6 w-16" />
              </div>
            ))}
          </div>
        ) : aliases.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <AtSign className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">No aliases found</p>
          </div>
        ) : (
          <div className="divide-y">
            {aliases.map((alias) => (
              <div key={`${alias.alias_email}-${alias.dbKey}`} className="flex items-center gap-3 p-3 sm:p-4 hover:bg-accent/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono text-sm truncate">{alias.alias_email}</span>
                    <Badge className={cn(
                      "text-[10px] px-1.5",
                      alias.active
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                        : "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
                    )}>
                      {alias.active ? "Active" : "Inactive"}
                    </Badge>
                    {isExpired(alias.expires_at) && (
                      <Badge className="bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20 text-[10px] px-1.5">Expired</Badge>
                    )}
                    {!alias.hasPassword && (
                      <Badge variant="secondary" className="text-[10px] px-1.5">No PW</Badge>
                    )}
                    <Badge variant="outline" className="text-[10px] px-1">{alias.dbLabel}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Owner: {alias.ownerName} · Expires: {formatExpiry(alias.expires_at)}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuLabel className="text-xs">Status</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => handleToggle(alias)}>
                      {alias.active ? (
                        <><PowerOff className="h-4 w-4 mr-2 text-red-500" /> Deactivate</>
                      ) : (
                        <><Power className="h-4 w-4 mr-2 text-emerald-500" /> Activate</>
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs">Extend Expiry</DropdownMenuLabel>
                    {[7, 30, 90].map((d) => (
                      <DropdownMenuItem key={d} onClick={() => handleExtend(alias, d)}>
                        <CalendarPlus className="h-4 w-4 mr-2" /> +{d} Days
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => handleResetPassword(alias)}>
                      <KeyRound className="h-4 w-4 mr-2" /> Reset Password
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
