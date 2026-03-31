import { cn } from "@/lib/utils";

interface DevFooterProps {
  variant?: "login" | "sidebar" | "inline";
  className?: string;
}

export default function DevFooter({ variant = "inline", className }: DevFooterProps) {
  if (variant === "sidebar") {
    return (
      <div className={cn("px-3 py-3 border-t", className)}>
        <a
          href="https://t.me/N2X4E"
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-accent/50 transition-all duration-200"
        >
          <div className="relative flex items-center justify-center w-6 h-6 rounded-md bg-gradient-to-br from-primary/20 to-primary/5 group-hover:from-primary/30 group-hover:to-primary/10 transition-all duration-200">
            <svg viewBox="0 0 24 24" className="w-3 h-3 text-primary/70 group-hover:text-primary transition-colors" fill="currentColor">
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
            </svg>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] leading-tight text-muted-foreground/50 group-hover:text-muted-foreground/70 transition-colors">
              Developed by
            </span>
            <span className="text-[11px] leading-tight font-semibold text-muted-foreground/60 group-hover:text-foreground/80 transition-colors tracking-tight">
              NiHAL x
            </span>
          </div>
        </a>
      </div>
    );
  }

  if (variant === "login") {
    return (
      <div className={cn("py-5 text-center", className)}>
        <a
          href="https://t.me/N2X4E"
          target="_blank"
          rel="noopener noreferrer"
          className="group inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-card/50 hover:bg-card border border-border/30 hover:border-border/60 transition-all duration-300 hover:shadow-sm"
        >
          <div className="relative flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-br from-primary/15 to-primary/5 group-hover:from-primary/25 group-hover:to-primary/10 transition-all duration-300">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-primary/60 group-hover:text-primary transition-colors duration-300" fill="currentColor">
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
            </svg>
          </div>
          <div className="flex flex-col items-start">
            <span className="text-[10px] leading-tight text-muted-foreground/40 group-hover:text-muted-foreground/60 transition-colors">
              Developed & Maintained by
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold tracking-tight text-muted-foreground/60 group-hover:text-foreground/80 transition-colors">
                NiHAL x
              </span>
              <span className="text-[10px] text-primary/50 group-hover:text-primary/80 font-medium transition-colors">
                @N2X4E
              </span>
            </div>
          </div>
          <svg className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 group-hover:translate-x-0.5 transition-all duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>
    );
  }

  return (
    <div className={cn("text-center", className)}>
      <a
        href="https://t.me/N2X4E"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
      >
        <span>by</span>
        <span className="font-semibold">NiHAL x</span>
        <span className="text-primary/50">@N2X4E</span>
      </a>
    </div>
  );
}
