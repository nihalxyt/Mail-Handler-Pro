import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useLocation } from "wouter";
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
import {
  ArrowLeft,
  Star,
  Trash2,
  MailOpen,
  Mail,
} from "lucide-react";

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "a", "abbr", "address", "b", "bdi", "bdo", "blockquote", "br",
      "caption", "cite", "code", "col", "colgroup", "dd", "del", "details",
      "dfn", "div", "dl", "dt", "em", "figcaption", "figure", "h1", "h2",
      "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd", "li",
      "mark", "ol", "p", "pre", "q", "rp", "rt", "ruby", "s", "samp",
      "section", "small", "span", "strong", "sub", "summary", "sup",
      "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr", "u",
      "ul", "var", "wbr", "center", "font",
    ],
    ALLOWED_ATTR: [
      "href", "src", "alt", "title", "width", "height", "style", "class",
      "target", "rel", "colspan", "rowspan", "align", "valign", "bgcolor",
      "border", "cellpadding", "cellspacing", "color", "face", "size",
    ],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ["target"],
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "textarea", "button"],
  });
}

export default function MailDetailPage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [mail, setMail] = useState<MailDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const fetchMail = useCallback(async () => {
    if (!params.id) return;
    setLoading(true);
    setError("");
    try {
      const data = await api.mail(decodeURIComponent(params.id));
      setMail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load email");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    fetchMail();
  }, [fetchMail]);

  useEffect(() => {
    if (!mail?.body || !iframeRef.current) return;
    const iframe = iframeRef.current;
    const doc = iframe.contentDocument;
    if (!doc) return;

    const isHtml = /<[a-z][\s\S]*>/i.test(mail.body);
    const content = isHtml
      ? sanitizeHtml(mail.body)
      : `<pre style="white-space:pre-wrap;word-break:break-word;font-family:inherit;margin:0;">${DOMPurify.sanitize(mail.body)}</pre>`;

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 14px;
            line-height: 1.6;
            color: ${document.documentElement.classList.contains("dark") ? "#e2e8f0" : "#1e293b"};
            background: transparent;
            padding: 0;
            word-break: break-word;
            overflow-wrap: break-word;
          }
          a { color: #3b82f6; }
          img { max-width: 100%; height: auto; }
          table { max-width: 100%; }
          pre { max-width: 100%; overflow-x: auto; }
          blockquote {
            border-left: 3px solid #d1d5db;
            padding-left: 12px;
            margin: 8px 0;
            color: #6b7280;
          }
        </style>
      </head>
      <body>${content}</body>
      </html>
    `);
    doc.close();

    const resizeObserver = new ResizeObserver(() => {
      if (doc.body) {
        iframe.style.height = doc.body.scrollHeight + 20 + "px";
      }
    });

    setTimeout(() => {
      if (doc.body) {
        iframe.style.height = doc.body.scrollHeight + 20 + "px";
        resizeObserver.observe(doc.body);
      }
    }, 100);

    return () => resizeObserver.disconnect();
  }, [mail]);

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

  if (loading) {
    return (
      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-6 w-3/4" />
        <div className="flex items-center gap-3 mt-4">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="space-y-1">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
        <Skeleton className="h-64 w-full mt-4" />
      </div>
    );
  }

  if (error || !mail) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
          <Mail className="h-8 w-8 text-destructive" />
        </div>
        <h3 className="text-lg font-medium mb-1">Email not found</h3>
        <p className="text-sm text-muted-foreground mb-4">{error || "This email could not be loaded"}</p>
        <Button variant="outline" onClick={() => navigate("/")}>
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
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b px-3 sm:px-4 py-2 flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => navigate("/")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={handleToggleRead}
          title={mail.read ? "Mark as unread" : "Mark as read"}
        >
          {mail.read ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
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
          className="h-9 w-9 text-destructive hover:text-destructive"
          onClick={handleDelete}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
          <h1 className="text-xl sm:text-2xl font-semibold mb-4 leading-tight">
            {mail.subject || "(No Subject)"}
          </h1>

          <div className="flex items-start gap-3 mb-6">
            <div
              className={cn(
                "h-10 w-10 rounded-full flex items-center justify-center text-white text-xs font-medium shrink-0",
                colorClass
              )}
            >
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{senderName}</span>
                <span className="text-xs text-muted-foreground truncate">
                  &lt;{senderEmail}&gt;
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
                <span>to {mail.aliasEmail}</span>
                <span>·</span>
                <span>{formatFullDate(mail.receivedAt)}</span>
              </div>
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden bg-card">
            <iframe
              ref={iframeRef}
              title="Email content"
              className="w-full border-0"
              style={{ minHeight: 200 }}
              sandbox="allow-same-origin"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
