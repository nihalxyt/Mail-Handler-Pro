import { type ReactNode } from "react";
import { useLocation } from "wouter";
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

const NAV_ITEMS = [
  { path: "/", label: "Inbox", icon: Inbox },
  { path: "/settings", label: "Settings", icon: Settings },
] as const;

export default function AppLayout({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const { user, switchAccount } = useAuth();
  const { theme, setTheme } = useTheme();

  const isMailDetail = location.startsWith("/mail/");
  const activePath = isMailDetail ? "/" : location;

  const themeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  const ThemeIcon = themeIcon;
  const nextTheme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="sticky top-0 z-20 bg-card/80 backdrop-blur-sm border-b px-3 sm:px-4 h-14 flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground">
            <Mail className="h-4 w-4" />
          </div>
          <span className="font-semibold text-sm hidden sm:block">MailBox</span>
        </div>

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
        <aside className="hidden md:flex w-56 border-r bg-sidebar shrink-0 flex-col p-2 gap-1">
          {NAV_ITEMS.map(({ path, label, icon: Icon }) => (
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
          ))}
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
  );
}
