import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, type MailDetail } from "@/lib/api";
import DOMPurify from "dompurify";
import {
  formatFullDate,
  extractSenderName,
  extractSenderEmail,
  getInitials,
  avatarColor,
  cn,
} from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ArrowLeft,
  Star,
  Trash2,
  MailOpen,
  Mail,
  Maximize2,
  Minimize2,
  ExternalLink,
  Download,
  Image,
} from "lucide-react";

function createFullHtmlDocument(html: string, isDark: boolean): string {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "a", "abbr", "address", "b", "bdi", "bdo", "blockquote", "br",
      "caption", "cite", "code", "col", "colgroup", "dd", "del", "details",
      "dfn", "div", "dl", "dt", "em", "figcaption", "figure", "h1", "h2",
      "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd", "li",
      "mark", "ol", "p", "pre", "q", "rp", "rt", "ruby", "s", "samp",
      "section", "small", "span", "strong", "sub", "summary", "sup",
      "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr", "u",
      "ul", "var", "wbr", "center", "font", "style",
    ],
    ALLOWED_ATTR: [
      "href", "alt", "title", "width", "height", "src",
      "target", "rel", "colspan", "rowspan", "align", "valign", "bgcolor",
      "border", "cellpadding", "cellspacing", "color", "face", "size",
      "style", "class", "id", "dir", "lang",
    ],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "textarea", "button", "link", "meta"],
    ADD_ATTR: ["target"],
  });

  const wrapper = document.createElement("div");
  wrapper.innerHTML = clean;
  wrapper.querySelectorAll("a").forEach((a) => {
    a.setAttribute("rel", "noopener noreferrer");
    a.setAttribute("target", "_blank");
    const href = a.getAttribute("href") || "";
    if (!/^https?:\/\//i.test(href) && !href.startsWith("mailto:")) {
      a.removeAttribute("href");
    }
  });

  return wrapper.innerHTML;
}

function createPlainTextHtml(text: string): string {
  const escaped = DOMPurify.sanitize(text);
  return `<pre style="white-space:pre-wrap;word-break:break-word;font-family:inherit;margin:0;">${escaped}</pre>`;
}

export default function MailDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [mail, setMail] = useState<MailDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fullView, setFullView] = useState(false);
  const [showImages, setShowImages] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const fetchMail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const data = await api.mail(decodeURIComponent(id!));
      setMail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load email");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchMail();
  }, [fetchMail]);

  useEffect(() => {
    if (!mail?.body || !iframeRef.current) return;
    const iframe = iframeRef.current;
    const doc = iframe.contentDocument;
    if (!doc) return;

    const isDark = document.documentElement.classList.contains("dark");
    const isHtml = /<[a-z][\s\S]*>/i.test(mail.body);
    const hasImages = /<img\s/i.test(mail.body);

    let content: string;
    if (isHtml) {
      content = createFullHtmlDocument(mail.body, isDark);
      if (!showImages) {
        const temp = document.createElement("div");
        temp.innerHTML = content;
        temp.querySelectorAll("img").forEach((img) => {
          const placeholder = document.createElement("div");
          placeholder.style.cssText = "display:inline-flex;align-items:center;gap:6px;padding:8px 12px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;color:#64748b;font-size:12px;margin:4px 0;cursor:pointer;";
          if (isDark) placeholder.style.cssText = "display:inline-flex;align-items:center;gap:6px;padding:8px 12px;background:#1e293b;border:1px solid #334155;border-radius:6px;color:#94a3b8;font-size:12px;margin:4px 0;cursor:pointer;";
          placeholder.textContent = `[Image: ${img.alt || "blocked"}]`;
          img.replaceWith(placeholder);
        });
        content = temp.innerHTML;
      }
    } else {
      content = createPlainTextHtml(mail.body);
    }

    if (hasImages && !showImages) {
      setShowImages(false);
    }

    const fg = isDark ? "#e2e8f0" : "#1e293b";
    const bg = isDark ? "#0f172a" : "#ffffff";
    const linkColor = isDark ? "#818cf8" : "#4f46e5";
    const borderColor = isDark ? "#334155" : "#e2e8f0";
    const quoteBg = isDark ? "#1e293b" : "#f8fafc";

    doc.open();
    doc.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
* { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif;
  font-size: 14px;
  line-height: 1.65;
  color: ${fg};
  background: ${bg};
  padding: ${fullView ? "24px" : "16px"};
  margin: 0;
  word-break: break-word;
  overflow-wrap: break-word;
  -webkit-font-smoothing: antialiased;
}
a { color: ${linkColor}; text-decoration: none; }
a:hover { text-decoration: underline; }
img { max-width: 100%; height: auto; border-radius: 4px; }
table { max-width: 100%; border-collapse: collapse; }
td, th { padding: 4px 8px; }
pre, code { max-width: 100%; overflow-x: auto; font-family: 'JetBrains Mono', monospace; font-size: 13px; }
blockquote {
  border-left: 3px solid ${borderColor};
  padding: 8px 16px;
  margin: 12px 0;
  background: ${quoteBg};
  border-radius: 0 6px 6px 0;
}
hr { border: none; border-top: 1px solid ${borderColor}; margin: 16px 0; }
h1,h2,h3,h4,h5,h6 { margin-top: 16px; margin-bottom: 8px; }
p { margin: 8px 0; }
ul, ol { padding-left: 24px; }
</style>
</head>
<body>${content}</body>
</html>`);
    doc.close();

    const resizeObserver = new ResizeObserver(() => {
      if (doc.body) {
        const h = doc.body.scrollHeight + 24;
        iframe.style.height = (fullView ? Math.max(h, 600) : h) + "px";
      }
    });

    setTimeout(() => {
      if (doc.body) {
        const h = doc.body.scrollHeight + 24;
        iframe.style.height = (fullView ? Math.max(h, 600) : h) + "px";
        resizeObserver.observe(doc.body);
      }
    }, 150);

    return () => resizeObserver.disconnect();
  }, [mail, showImages, fullView]);

  const handleStar = async () => {
    if (!mail) return;
    const newVal = !mail.starred;
    setMail({ ...mail, starred: newVal });
    try {
      await api.patchMail(mail.id, { starred: newVal });
    } catch {
      setMail({ ...mail, starred: !newVal });
    }
  };

  const handleToggleRead = async () => {
    if (!mail) return;
    const newVal = !mail.read;
    setMail({ ...mail, read: newVal });
    await api.patchMail(mail.id, { read: newVal });
  };

  const handleDelete = async () => {
    if (!mail) return;
    await api.patchMail(mail.id, { deleted: true });
    navigate("/");
  };

  const hasHtmlImages = mail?.body ? /<img\s/i.test(mail.body) : false;

  if (loading) {
    return (
      <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <Skeleton className="h-5 w-24" />
        </div>
        <Skeleton className="h-8 w-3/4" />
        <div className="flex items-center gap-3 mt-4">
          <Skeleton className="h-11 w-11 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-3 w-36" />
          </div>
        </div>
        <Skeleton className="h-80 w-full mt-4 rounded-xl" />
      </div>
    );
  }

  if (error || !mail) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4">
        <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center mb-4">
          <Mail className="h-8 w-8 text-destructive" />
        </div>
        <h3 className="text-lg font-semibold mb-1">Email not found</h3>
        <p className="text-sm text-muted-foreground mb-4">{error || "This email could not be loaded"}</p>
        <Button variant="outline" onClick={() => navigate("/")} className="rounded-xl">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to inbox
        </Button>
      </div>
    );
  }

  const senderName = extractSenderName(mail.from);
  const senderEmail = extractSenderEmail(mail.from);
  const initials = getInitials(senderName);
  const colorClass = avatarColor(mail.from);

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-background/80 glass border-b px-3 sm:px-4 py-2 flex items-center gap-1.5 sm:gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-lg"
          onClick={() => navigate("/")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1" />
        {hasHtmlImages && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={showImages ? "secondary" : "ghost"}
                size="icon"
                className="h-9 w-9 rounded-lg"
                onClick={() => setShowImages(!showImages)}
              >
                <Image className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{showImages ? "Hide images" : "Show images"}</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={fullView ? "secondary" : "ghost"}
              size="icon"
              className="h-9 w-9 rounded-lg"
              onClick={() => setFullView(!fullView)}
            >
              {fullView ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{fullView ? "Compact view" : "Full view"}</TooltipContent>
        </Tooltip>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-lg"
          onClick={handleToggleRead}
          title={mail.read ? "Mark as unread" : "Mark as read"}
        >
          {mail.read ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-lg"
          onClick={handleStar}
        >
          <Star
            className={cn(
              "h-4 w-4",
              mail.starred ? "fill-amber-400 text-amber-400" : ""
            )}
          />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-lg text-destructive hover:text-destructive"
          onClick={handleDelete}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className={cn(
          "mx-auto px-4 sm:px-6 py-4 sm:py-6",
          fullView ? "max-w-5xl" : "max-w-3xl"
        )}>
          <h1 className="text-xl sm:text-2xl font-bold mb-5 leading-tight tracking-tight">
            {mail.subject || "(No Subject)"}
          </h1>

          <div className="flex items-start gap-3 mb-6">
            <div
              className={cn(
                "h-11 w-11 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0",
                colorClass
              )}
            >
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm">{senderName}</span>
                <span className="text-xs text-muted-foreground truncate">
                  &lt;{senderEmail}&gt;
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
                <span>to <span className="font-medium">{mail.aliasEmail}</span></span>
                <span className="text-muted-foreground/40">|</span>
                <span>{formatFullDate(mail.receivedAt)}</span>
              </div>
            </div>
          </div>

          {hasHtmlImages && !showImages && (
            <button
              onClick={() => setShowImages(true)}
              className="flex items-center gap-2 w-full p-3 mb-4 text-sm text-muted-foreground bg-muted/50 hover:bg-muted rounded-xl border border-border/50 transition-colors"
            >
              <Image className="h-4 w-4 shrink-0" />
              <span>Images are hidden for security.</span>
              <span className="text-primary font-medium ml-auto shrink-0">Show images</span>
            </button>
          )}

          <div className={cn(
            "border rounded-xl overflow-hidden bg-card shadow-sm",
            fullView && "shadow-md"
          )}>
            <iframe
              ref={iframeRef}
              title="Email content"
              className="w-full border-0"
              style={{ minHeight: fullView ? 600 : 200 }}
              sandbox="allow-same-origin"
            />
          </div>

          <div className="mt-6 pt-4 border-t flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground/50">
              via {mail.bot || "bot"} | {mail.aliasEmail}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs gap-1.5 rounded-lg"
                onClick={() => {
                  const blob = new Blob([mail.body], { type: "text/html" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${(mail.subject || "email").replace(/[^a-zA-Z0-9]/g, "_")}.html`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs gap-1.5 rounded-lg"
                onClick={() => {
                  const blob = new Blob([mail.body], { type: "text/html" });
                  const url = URL.createObjectURL(blob);
                  window.open(url, "_blank");
                }}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open in tab
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
