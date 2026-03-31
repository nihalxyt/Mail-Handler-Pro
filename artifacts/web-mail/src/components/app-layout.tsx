import { useState, useEffect, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/auth-context";
import { useTheme } from "@/contexts/theme-context";
import { cn, avatarColor, getInitials } from "@/lib/utils";
import { api } from "@/lib/api";
import {
  Inbox,
  Settings,
  ChevronDown,
  Mail,
  Sun,
  Moon,
  Monitor,
  PanelLeftClose,
  PanelLeft,
  Shield,
  LogOut,
  Check,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import DevFooter from "@/components/dev-footer";

const NAV_ITEMS = [
  { path: "/", label: "Inbox", icon: Inbox },
  { path: "/settings", label: "Settings", icon: Settings },
] as const;

export default function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, switchAccount, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem("sidebar-collapsed") === "true";
  });
  const [isAdmin, setIsAdmin] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role && ["admin", "moderator", "super_admin"].includes(user.role)) {
      setIsAdmin(true);
    } else {
      api.adminCheck().then(() => setIsAdmin(true)).catch(() => setIsAdmin(false));
    }
  }, [user]);

  const isMailDetail = location.pathname.startsWith("/mail/");
  const isAdminPage = location.pathname.startsWith("/admin");
  const activePath = isMailDetail ? "/" : isAdminPage ? "/admin" : location.pathname;

  const themeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  const ThemeIcon = themeIcon;
  const nextTheme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";

  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    localStorage.setItem("sidebar-collapsed", String(next));
  };

  const navItems = [
    ...NAV_ITEMS,
    ...(isAdmin ? [{ path: "/admin", label: "Admin", icon: Shield }] as const : []),
  ];

  const handleSwitch = async (email: string) => {
    if (email === user?.email || switching) return;
    setSwitching(email);
    try {
      await switchAccount(email);
      navigate("/");
    } catch {
    } finally {
      setSwitching(null);
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col h-screen bg-background">
        <header className="sticky top-0 z-20 bg-card/80 glass border-b px-3 sm:px-4 h-14 flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-sm">
              <Mail className="h-4 w-4" />
            </div>
            <span className="font-bold text-sm hidden sm:block tracking-tight">ZayMail</span>
          </div>

          <button
            onClick={toggleSidebar}
            className="hidden md:flex p-2 rounded-lg hover:bg-accent transition-colors"
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? (
              <PanelLeft className="h-4 w-4 text-muted-foreground" />
            ) : (
              <PanelLeftClose className="h-4 w-4 text-muted-foreground" />
            )}
          </button>

          <div className="flex-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setTheme(nextTheme)}
                className="p-2 rounded-lg hover:bg-accent transition-colors"
              >
                <ThemeIcon className="h-4 w-4 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Theme: {theme}</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-accent transition-colors max-w-[200px] sm:max-w-[280px]">
              <div className={cn(
                "h-7 w-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0",
                avatarColor(user?.email || "")
              )}>
                {getInitials(user?.email?.split("@")[0] || "?")}
              </div>
              <span className="text-sm font-medium truncate hidden sm:block">{user?.email}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[300px] sm:w-[340px]">
              <DropdownMenuLabel className="font-normal px-3 py-2.5">
                <div className="flex flex-col gap-0.5">
                  <p className="text-xs text-muted-foreground">Signed in as</p>
                  <p className="text-sm font-semibold truncate">{user?.email}</p>
                  {user?.role && user.role !== "user" && (
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-primary mt-0.5">
                      {user.role.replace("_", " ")}
                    </p>
                  )}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {user?.aliases && user.aliases.length > 1 && (
                <>
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground px-3 py-1.5">
                    Switch account
                  </DropdownMenuLabel>
                  {user.aliases.map((alias) => {
                    const isActive = alias.email === user.email;
                    const isSwitching = switching === alias.email;
                    const color = avatarColor(alias.email);
                    const initials = getInitials(alias.email.split("@")[0]);
                    return (
                      <DropdownMenuItem
                        key={alias.email}
                        onClick={() => handleSwitch(alias.email)}
                        disabled={isActive || !alias.active || isSwitching}
                        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer"
                      >
                        <div className={cn(
                          "h-8 w-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0",
                          color,
                          (!alias.active && !isActive) && "opacity-50"
                        )}>
                          {initials}
                        </div>
                        <span className={cn(
                          "text-sm truncate flex-1",
                          isActive && "font-semibold",
                          !alias.active && "text-muted-foreground"
                        )}>
                          {alias.email}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isSwitching && (
                            <span className="h-3.5 w-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                          )}
                          {isActive && (
                            <Check className="h-4 w-4 text-primary" />
                          )}
                          {!alias.active && !isActive && (
                            <span className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Off</span>
                          )}
                        </div>
                      </DropdownMenuItem>
                    );
                  })}
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem
                onClick={() => navigate("/settings")}
                className="flex items-center gap-3 px-3 py-2.5 cursor-pointer"
              >
                <Settings className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Settings</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={logout}
                className="flex items-center gap-3 px-3 py-2.5 cursor-pointer text-destructive focus:text-destructive"
              >
                <LogOut className="h-4 w-4" />
                <span className="text-sm">Sign out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <aside
            className={cn(
              "hidden md:flex border-r bg-sidebar shrink-0 flex-col justify-between transition-all duration-200",
              sidebarCollapsed ? "w-14" : "w-52"
            )}
          >
            <div className="flex flex-col p-2 gap-1">
              {navItems.map(({ path, label, icon: Icon }) =>
                sidebarCollapsed ? (
                  <Tooltip key={path}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => navigate(path)}
                        className={cn(
                          "flex items-center justify-center h-10 w-10 rounded-lg transition-colors",
                          activePath === path
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">{label}</TooltipContent>
                  </Tooltip>
                ) : (
                  <button
                    key={path}
                    onClick={() => navigate(path)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors w-full text-left",
                      activePath === path
                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                        : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {label}
                  </button>
                )
              )}
            </div>
            {!sidebarCollapsed && <DevFooter variant="sidebar" />}
          </aside>

          <main className="flex-1 overflow-hidden flex flex-col">{children}</main>
        </div>

        <nav className="md:hidden sticky bottom-0 z-20 bg-card/80 glass border-t flex items-center h-14 shrink-0">
          {navItems.map(({ path, label, icon: Icon }) => (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-0.5 py-1 transition-colors",
                activePath === path
                  ? "text-primary"
                  : "text-muted-foreground"
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{label}</span>
            </button>
          ))}
        </nav>
      </div>
    </TooltipProvider>
  );
}
