import { useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/auth-context";
import { useTheme } from "@/contexts/theme-context";
import { cn } from "@/lib/utils";
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
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const NAV_ITEMS = [
  { path: "/", label: "Inbox", icon: Inbox },
  { path: "/settings", label: "Settings", icon: Settings },
] as const;

export default function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, switchAccount } = useAuth();
  const { theme, setTheme } = useTheme();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem("sidebar-collapsed") === "true";
  });

  const isMailDetail = location.pathname.startsWith("/mail/");
  const activePath = isMailDetail ? "/" : location.pathname;

  const themeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  const ThemeIcon = themeIcon;
  const nextTheme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";

  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    localStorage.setItem("sidebar-collapsed", String(next));
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col h-screen bg-background">
        <header className="sticky top-0 z-20 bg-card/80 backdrop-blur-sm border-b px-3 sm:px-4 h-14 flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground">
              <Mail className="h-4 w-4" />
            </div>
            <span className="font-semibold text-sm hidden sm:block">MailBox</span>
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

          <button
            onClick={() => setTheme(nextTheme)}
            className="p-2 rounded-lg hover:bg-accent transition-colors"
            title={`Theme: ${theme}`}
          >
            <ThemeIcon className="h-4 w-4 text-muted-foreground" />
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-accent transition-colors max-w-[200px] sm:max-w-[280px]">
              <span className="text-sm font-medium truncate">{user?.email}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                Switch account
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {user?.aliases.map((alias) => (
                <DropdownMenuItem
                  key={alias.email}
                  onClick={() => {
                    if (alias.email !== user.email) {
                      switchAccount(alias.email).then(() => navigate("/"));
                    }
                  }}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="truncate text-sm">{alias.email}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {alias.email === user.email && (
                      <Badge variant="default" className="text-[10px] px-1.5 py-0">
                        Active
                      </Badge>
                    )}
                    {!alias.active && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        Disabled
                      </Badge>
                    )}
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <aside
            className={cn(
              "hidden md:flex border-r bg-sidebar shrink-0 flex-col p-2 gap-1 transition-all duration-200",
              sidebarCollapsed ? "w-14" : "w-56"
            )}
          >
            {NAV_ITEMS.map(({ path, label, icon: Icon }) =>
              sidebarCollapsed ? (
                <Tooltip key={path}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => navigate(path)}
                      className={cn(
                        "flex items-center justify-center h-10 w-10 rounded-lg transition-colors",
                        activePath === path
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50"
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
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {label}
                </button>
              )
            )}
          </aside>

          <main className="flex-1 overflow-hidden flex flex-col">{children}</main>
        </div>

        <nav className="md:hidden sticky bottom-0 z-20 bg-card/80 backdrop-blur-sm border-t flex items-center h-14 shrink-0">
          {NAV_ITEMS.map(({ path, label, icon: Icon }) => (
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
