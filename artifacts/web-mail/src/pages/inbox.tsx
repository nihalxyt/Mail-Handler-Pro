import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { api, type MailSummary, type InboxStats } from "@/lib/api";
import { useAuth } from "@/contexts/auth-context";
import { formatDate, extractSenderName, getInitials, avatarColor } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  Star,
  Inbox as InboxIcon,
  MailOpen,
  RefreshCw,
  Filter,
  Trash2,
  MailCheck,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const FILTERS = [
  { value: "all", label: "All Mail", icon: InboxIcon },
  { value: "unread", label: "Unread", icon: MailOpen },
  { value: "starred", label: "Starred", icon: Star },
] as const;

const PAGE_SIZE = 20;

export default function InboxPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [mails, setMails] = useState<MailSummary[]>([]);
  const [stats, setStats] = useState<InboxStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const pullStartY = useRef<number>(0);
  const pullDelta = useRef<number>(0);
  const pullIndicatorRef = useRef<HTMLDivElement | null>(null);
  const isPulling = useRef(false);
  const swipeStartX = useRef<Map<string, number>>(new Map());
  const swipeRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const fetchInbox = useCallback(
    async (p: number, s: string, f: string, append = false) => {
      if (!append) setLoading(true);
      else setLoadingMore(true);
      try {
        const [inbox, st] = await Promise.all([
          api.inbox({ page: p, limit: PAGE_SIZE, search: s, filter: f }),
          !append ? api.inboxStats() : Promise.resolve(null),
        ]);
        if (append) {
          setMails((prev) => [...prev, ...inbox.mails]);
        } else {
          setMails(inbox.mails);
        }
        if (st) setStats(st);
        setHasMore(p + 1 < inbox.totalPages);
        setPage(p);
      } catch {
        // handled
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchInbox(0, search, filter);
  }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
          fetchInbox(page + 1, search, filter, true);
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loading, page, search, filter, fetchInbox]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const [inbox, st] = await Promise.all([
        api.inbox({ page: 0, limit: PAGE_SIZE, search, filter }),
        api.inboxStats(),
      ]);
      setMails(inbox.mails);
      setStats(st);
      setHasMore(inbox.totalPages > 1);
      setPage(0);
    } catch {
      // handled
    } finally {
      setRefreshing(false);
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const scrollEl = scrollRef.current;
    if (!scrollEl || scrollEl.scrollTop > 5) return;
    pullStartY.current = e.touches[0].clientY;
    isPulling.current = true;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isPulling.current) return;
    const delta = e.touches[0].clientY - pullStartY.current;
    pullDelta.current = delta;
    if (delta > 0 && delta < 120 && pullIndicatorRef.current) {
      const progress = Math.min(delta / 80, 1);
      pullIndicatorRef.current.style.height = `${delta * 0.5}px`;
      pullIndicatorRef.current.style.opacity = String(progress);
    }
  };

  const handleTouchEnd = () => {
    if (!isPulling.current) return;
    isPulling.current = false;
    if (pullIndicatorRef.current) {
      pullIndicatorRef.current.style.height = "0px";
      pullIndicatorRef.current.style.opacity = "0";
    }
    if (pullDelta.current > 80) {
      handleRefresh();
    }
    pullDelta.current = 0;
  };

  const handleSearch = (val: string) => {
    setSearch(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setPage(0);
      fetchInbox(0, val, filter);
    }, 400);
  };

  const handleStarToggle = async (e: React.MouseEvent, mail: MailSummary) => {
    e.stopPropagation();
    const newVal = !mail.starred;
    setMails((prev) =>
      prev.map((m) => (m.id === mail.id ? { ...m, starred: newVal } : m))
    );
    try {
      await api.patchMail(mail.id, { starred: newVal });
    } catch {
      setMails((prev) =>
        prev.map((m) => (m.id === mail.id ? { ...m, starred: !newVal } : m))
      );
    }
  };

  const handleSwipeStart = (mailId: string, clientX: number) => {
    swipeStartX.current.set(mailId, clientX);
  };

  const handleSwipeMove = (mailId: string, clientX: number) => {
    const startX = swipeStartX.current.get(mailId);
    if (startX === undefined) return;
    const delta = clientX - startX;
    const el = swipeRefs.current.get(mailId);
    if (!el) return;
    if (delta < -10) {
      const translateX = Math.max(delta, -100);
      el.style.transform = `translateX(${translateX}px)`;
      el.style.transition = "none";
    }
  };

  const handleSwipeEnd = async (mailId: string, clientX: number) => {
    const startX = swipeStartX.current.get(mailId);
    swipeStartX.current.delete(mailId);
    if (startX === undefined) return;
    const delta = clientX - startX;
    const el = swipeRefs.current.get(mailId);
    if (el) {
      el.style.transform = "";
      el.style.transition = "transform 0.2s ease";
    }
    if (delta < -60) {
      setMails((prev) => prev.filter((m) => m.id !== mailId));
      try {
        await api.patchMail(mailId, { deleted: true });
      } catch {
        fetchInbox(0, search, filter);
      }
    }
  };

  const handleSwipeAction = async (mailId: string, action: "delete" | "read") => {
    if (action === "delete") {
      setMails((prev) => prev.filter((m) => m.id !== mailId));
      await api.patchMail(mailId, { deleted: true });
    } else {
      const mail = mails.find((m) => m.id === mailId);
      if (!mail) return;
      const newRead = !mail.read;
      setMails((prev) =>
        prev.map((m) => (m.id === mailId ? { ...m, read: newRead } : m))
      );
      await api.patchMail(mailId, { read: newRead });
    }
  };

  const activeFilter = FILTERS.find((f) => f.value === filter) || FILTERS[0];

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b px-3 sm:px-4 py-3 space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search emails..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 h-9 shrink-0">
                <Filter className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{activeFilter.label}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {FILTERS.map((f) => (
                <DropdownMenuItem
                  key={f.value}
                  onClick={() => {
                    setFilter(f.value);
                    setPage(0);
                  }}
                  className={cn(filter === f.value && "bg-accent")}
                >
                  <f.icon className="h-4 w-4 mr-2" />
                  {f.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </Button>
        </div>
        {stats && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{stats.total} total</span>
            {stats.unread > 0 && (
              <span className="font-medium text-primary">{stats.unread} unread</span>
            )}
            {stats.starred > 0 && <span>{stats.starred} starred</span>}
          </div>
        )}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div
          ref={pullIndicatorRef}
          className="flex items-center justify-center overflow-hidden"
          style={{ height: 0, opacity: 0, transition: "height 0.2s, opacity 0.2s" }}
        >
          <RefreshCw className="h-5 w-5 text-primary animate-spin" />
        </div>

        {loading ? (
          <div className="divide-y">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 p-3 sm:p-4">
                <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-3 w-12" />
                  </div>
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : mails.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <InboxIcon className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-1">No emails found</h3>
            <p className="text-sm text-muted-foreground max-w-xs">
              {search
                ? "Try adjusting your search terms"
                : filter !== "all"
                  ? `No ${filter} emails in ${user?.email}`
                  : `No emails in ${user?.email} yet`}
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {mails.map((mail) => {
              const senderName = extractSenderName(mail.from);
              const initials = getInitials(senderName);
              const colorClass = avatarColor(mail.from);

              return (
                <div key={mail.id} className="relative overflow-hidden group">
                  <div className="absolute inset-y-0 right-0 w-24 flex items-center justify-center bg-destructive text-destructive-foreground z-0 md:hidden">
                    <Trash2 className="h-5 w-5" />
                  </div>

                  <div
                    ref={(el) => {
                      if (el) swipeRefs.current.set(mail.id, el);
                    }}
                    onTouchStart={(e) => handleSwipeStart(mail.id, e.touches[0].clientX)}
                    onTouchMove={(e) => handleSwipeMove(mail.id, e.touches[0].clientX)}
                    onTouchEnd={(e) =>
                      handleSwipeEnd(mail.id, e.changedTouches[0].clientX)
                    }
                    className="relative z-10 bg-background"
                  >
                    <button
                      onClick={() => navigate(`/mail/${encodeURIComponent(mail.id)}`)}
                      className={cn(
                        "w-full flex items-start gap-3 p-3 sm:p-4 text-left transition-colors hover:bg-accent/50",
                        !mail.read && "bg-primary/[0.03]"
                      )}
                    >
                      <div
                        className={cn(
                          "h-10 w-10 rounded-full flex items-center justify-center text-white text-xs font-medium shrink-0",
                          colorClass
                        )}
                      >
                        {initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={cn(
                              "text-sm truncate",
                              !mail.read
                                ? "font-semibold"
                                : "font-normal text-muted-foreground"
                            )}
                          >
                            {senderName}
                          </span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {formatDate(mail.receivedAt)}
                          </span>
                        </div>
                        <p
                          className={cn(
                            "text-sm truncate",
                            !mail.read ? "font-medium" : "text-muted-foreground"
                          )}
                        >
                          {mail.subject || "(No Subject)"}
                        </p>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {mail.snippet}
                        </p>
                      </div>
                      <div className="flex flex-col items-center gap-1 shrink-0 mt-1">
                        <button
                          onClick={(e) => handleStarToggle(e, mail)}
                          className="p-1 -m-1 rounded hover:bg-accent transition-colors"
                        >
                          <Star
                            className={cn(
                              "h-4 w-4",
                              mail.starred
                                ? "fill-amber-400 text-amber-400"
                                : "text-muted-foreground/40"
                            )}
                          />
                        </button>
                        <div className="hidden group-hover:flex gap-0.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSwipeAction(mail.id, "read");
                            }}
                            className="p-1 rounded hover:bg-accent"
                            title={mail.read ? "Mark unread" : "Mark read"}
                          >
                            <MailCheck className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSwipeAction(mail.id, "delete");
                            }}
                            className="p-1 rounded hover:bg-accent"
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
              );
            })}

            <div ref={sentinelRef} className="h-1" />

            {loadingMore && (
              <div className="flex items-center justify-center py-4">
                <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
