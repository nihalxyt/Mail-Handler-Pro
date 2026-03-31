import { useState, useEffect, useCallback } from "react";
import { api, type AdminUser } from "@/lib/api";
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
  UserCheck,
  UserX,
  Shield,
  ShieldOff,
  RefreshCw,
  ArrowLeft,
  Filter,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "pending", label: "Pending" },
  { value: "banned", label: "Banned" },
];

export default function AdminUsers() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.adminUsers({ status: statusFilter, search });
      setUsers(res.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleStatusChange = async (user: AdminUser, status: string) => {
    try {
      await api.adminUpdateUserStatus(user.tg_user_id, status, user.dbKey);
      setUsers((prev) =>
        prev.map((u) =>
          u.tg_user_id === user.tg_user_id && u.dbKey === user.dbKey
            ? { ...u, status }
            : u
        )
      );
    } catch {
      fetchUsers();
    }
  };

  const handleRoleChange = async (user: AdminUser, role: string) => {
    try {
      await api.adminUpdateUserRole(user.tg_user_id, role, user.dbKey);
      setUsers((prev) =>
        prev.map((u) =>
          u.tg_user_id === user.tg_user_id && u.dbKey === user.dbKey
            ? { ...u, role }
            : u
        )
      );
    } catch {
      fetchUsers();
    }
  };

  const statusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      active: "default",
      pending: "secondary",
      banned: "destructive",
    };
    return <Badge variant={variants[status] || "outline"}>{status}</Badge>;
  };

  const roleBadge = (role: string) => {
    if (role === "admin" || role === "super_admin")
      return <Badge variant="outline" className="text-amber-600 border-amber-300">{role}</Badge>;
    if (role === "moderator")
      return <Badge variant="outline" className="text-blue-600 border-blue-300">{role}</Badge>;
    return null;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b px-3 sm:px-4 py-3 space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => navigate("/admin")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold flex-1">User Management</h1>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={fetchUsers}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 h-9 shrink-0">
                <Filter className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{STATUS_FILTERS.find((f) => f.value === statusFilter)?.label}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {STATUS_FILTERS.map((f) => (
                <DropdownMenuItem key={f.value} onClick={() => setStatusFilter(f.value)} className={cn(statusFilter === f.value && "bg-accent")}>
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
            <Button variant="outline" onClick={fetchUsers}><RefreshCw className="h-4 w-4 mr-2" /> Retry</Button>
          </div>
        ) : loading ? (
          <div className="divide-y">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3 sm:p-4">
                <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-6 w-16" />
              </div>
            ))}
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-muted-foreground">No users found</p>
          </div>
        ) : (
          <div className="divide-y">
            {users.map((user) => (
              <div key={`${user.tg_user_id}-${user.dbKey}`} className="flex items-center gap-3 p-3 sm:p-4 hover:bg-accent/50 transition-colors">
                <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-xs font-medium shrink-0">
                  {(user.name || user.username || "?").substring(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate">{user.name || user.username || `User ${user.tg_user_id}`}</span>
                    {statusBadge(user.status)}
                    {roleBadge(user.role)}
                    <Badge variant="outline" className="text-[10px]">{user.dbLabel}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    @{user.username || "—"} · {user.aliasCount} aliases · {user.stats?.total_mails || 0} mails
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel className="text-xs">Status</DropdownMenuLabel>
                    {user.status !== "active" && (
                      <DropdownMenuItem onClick={() => handleStatusChange(user, "active")}>
                        <UserCheck className="h-4 w-4 mr-2 text-green-500" /> Approve
                      </DropdownMenuItem>
                    )}
                    {user.status !== "banned" && (
                      <DropdownMenuItem onClick={() => handleStatusChange(user, "banned")}>
                        <UserX className="h-4 w-4 mr-2 text-red-500" /> Ban
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs">Role</DropdownMenuLabel>
                    {user.role !== "admin" && (
                      <DropdownMenuItem onClick={() => handleRoleChange(user, "admin")}>
                        <Shield className="h-4 w-4 mr-2 text-amber-500" /> Make Admin
                      </DropdownMenuItem>
                    )}
                    {user.role !== "user" && (
                      <DropdownMenuItem onClick={() => handleRoleChange(user, "user")}>
                        <ShieldOff className="h-4 w-4 mr-2" /> Remove Admin
                      </DropdownMenuItem>
                    )}
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
