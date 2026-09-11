import mark from "@/assets/fiqhgpt-mark.png";
import { cn } from "@/lib/utils";

export function BrandMark({ className, size = 32 }: { className?: string; size?: number }) {
  return (
    <img
      src={mark}
      alt="FiqhGPT"
      width={size}
      height={size}
      className={cn("shrink-0 select-none", className)}
      style={{ width: size, height: size }}
    />
  );
}

export function BrandLockup({ subtitle }: { subtitle?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark size={30} />
      <div className="leading-tight">
        <div className="font-display text-[15px] font-semibold tracking-tight">FiqhGPT</div>
        {subtitle ? (
          <div className="text-[11px] text-muted-foreground">{subtitle}</div>
        ) : null}
      </div>
    </div>
  );
}
