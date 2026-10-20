import { clsx, type ClassValue } from "clsx";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** The platform's command modifier, spelled out in ASCII. */
export const MOD = isMac ? "Cmd" : "Ctrl";

/** New thread: Cmd+N in the desktop app; a browser keeps Cmd+N for a new window, so there it is Cmd+Shift+O. */
export const NEW_THREAD_KEYS: string[] =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window ? [MOD, "N"] : [MOD, "Shift", "O"];

export function Kbd(props: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border border-line bg-raised px-1 font-sans text-2xs font-medium text-muted",
        props.className,
      )}
    >
      {props.children}
    </kbd>
  );
}

export function Shortcut(props: { keys: string[]; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", props.className)} aria-hidden="true">
      {props.keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </span>
  );
}

export function Spinner(props: { size?: number; className?: string; label?: string }) {
  const size = props.size ?? 14;
  return (
    // An image, not a live region: a labelled spinner in every running row would have VoiceOver
    // announcing "Running" each time a tool starts.
    <span
      role={props.label ? "img" : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : true}
      className={cn("spin-ring shrink-0", props.className)}
      style={{ width: size, height: size }}
    />
  );
}

export function Shimmer(props: { children: ReactNode; className?: string }) {
  return <span className={cn("shimmer", props.className)}>{props.children}</span>;
}

type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-inverse text-inverse-fg hover:opacity-90",
  accent: "bg-accent text-accent-fg hover:bg-accent-hover",
  secondary: "bg-raised text-fg shadow-btn hover:bg-hover",
  ghost: "text-muted hover:bg-hover hover:text-fg",
  danger: "text-danger-text shadow-[0_0_0_1px_var(--border-strong)] hover:bg-danger-soft",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 gap-1.5 rounded-md px-2.5 text-sm",
  md: "h-8 gap-2 rounded-lg px-3 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, className, children, disabled, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[background-color,color,opacity,transform] duration-150 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={12} /> : null}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: "xs" | "sm" | "md";
  active?: boolean;
}

const ICON_SIZES = { xs: "size-6 rounded-md", sm: "size-7 rounded-md", md: "size-8 rounded-lg" } as const;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = "sm", active = false, className, children, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center text-muted transition-[background-color,color,transform] duration-150 ease-out hover:bg-hover hover:text-fg active:scale-[0.94] disabled:pointer-events-none disabled:opacity-40",
        active && "bg-active text-fg",
        ICON_SIZES[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

/** The Muse Code GUI mark, drawn to match the app icon and favicon: the arch on a navy tile. */
export function Logo(props: { size?: number; className?: string }) {
  const size = props.size ?? 22;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={props.className} aria-hidden="true">
      <rect width="32" height="32" rx="7.5" fill="oklch(0.25 0.045 280)" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="7" fill="none" stroke="oklch(1 0 0 / 0.1)" />
      <g transform="translate(6.83,6) scale(0.03558) translate(-368.6,-319)">
        <path fill="oklch(0.96 0.01 280)" d="M 619.9 322 L 519.02 426.04 A 24.82 24.82 0 0 0 512.02 443.31 L 512.02 478 C 512.02 484 510.65 493.6 502.08 502 L 376.48 625 C 369.33 632 369.13 637 369.13 649 L 369.13 797.92 L 417.84 836.97 L 417.84 698.4 A 26.32 26.32 0 0 1 426.21 679.15 L 527.95 584.32 A 24.25 24.25 0 0 0 535.67 566.58 L 535.67 493.24 A 20.71 20.71 0 0 1 541.83 478.51 L 587.23 433.67 L 587.23 608.77 A 25.15 25.15 0 0 1 577.76 628.43 L 484.28 703 C 473.33 711.73 463.65 717 463.65 731 L 463.65 835.82 L 519.67 880.73 L 519.67 776 C 519.67 758 528 754.18 535.86 748 L 615.38 685.49 A 18 18 0 0 1 637.62 685.49 L 717.14 748 C 725 754.18 733.33 758 733.33 776 L 733.33 880.73 L 789.35 835.82 L 789.35 731 C 789.35 717 779.67 711.73 768.72 703 L 675.24 628.43 A 25.15 25.15 0 0 1 665.77 608.77 L 665.77 433.67 L 711.17 478.51 A 20.71 20.71 0 0 1 717.33 493.24 L 717.33 566.58 A 24.25 24.25 0 0 0 725.05 584.32 L 826.79 679.15 A 26.32 26.32 0 0 1 835.16 698.4 L 835.16 836.97 L 883.87 797.92 L 883.87 649 C 883.87 637 883.67 632 876.52 625 L 750.92 502 C 742.35 493.6 740.98 484 740.98 478 L 740.98 443.31 A 24.82 24.82 0 0 0 733.98 426.04 L 633.1 322 C 629.62 318.41 628.5 319.6 626.5 319.6 C 624.5 319.6 623.38 318.41 619.9 322 Z" />
      </g>
    </svg>
  );
}
