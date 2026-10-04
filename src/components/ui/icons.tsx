// Minimal stroke icon set (lucide-style paths) — no icon dependency.
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function make(paths: React.ReactNode) {
  return function Icon({ size = 18, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        {...rest}
      >
        {paths}
      </svg>
    );
  };
}

export const IconHome = make(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-6h4v6" /></>);
export const IconChat = make(<><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5A8 8 0 1 1 21 12Z" /><path d="M8.5 11h7M8.5 14h4" /></>);
export const IconCube = make(<><path d="m12 2 9 5v10l-9 5-9-5V7Z" /><path d="m3 7 9 5 9-5M12 12v10" /></>);
export const IconPulse = make(<path d="M3 12h4l2.5-6 5 12 2.5-6h4" />);
export const IconPlug = make(<><path d="M9 2v6M15 2v6" /><path d="M6 8h12v3a6 6 0 0 1-12 0Z" /><path d="M12 17v5" /></>);
export const IconKey = make(<><circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.7 12.3 9.3-9.3M17 6l3 3M14.5 8.5l2 2" /></>);
export const IconServer = make(<><rect x="3" y="3" width="18" height="7" rx="2" /><rect x="3" y="14" width="18" height="7" rx="2" /><path d="M7 6.5h.01M7 17.5h.01" /></>);
export const IconBook = make(<><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5Z" /><path d="M4 19.5V4.5M8 7h8M8 11h6" /></>);
export const IconSparkle = make(<><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z" /></>);
export const IconCheck = make(<path d="m5 12.5 4.5 4.5L19 7.5" />);
export const IconArrowRight = make(<><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>);
export const IconCopy = make(<><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>);
export const IconMenu = make(<path d="M4 6h16M4 12h16M4 18h16" />);
export const IconX = make(<path d="M6 6l12 12M18 6 6 18" />);
export const IconCompass = make(<><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5Z" /></>);
export const IconInfo = make(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>);
export const IconAlert = make(<><path d="M12 3 2 21h20Z" /><path d="M12 10v5M12 18h.01" /></>);
export const IconRefresh = make(<><path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" /><path d="M4 3v5h5" /><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16" /><path d="M20 21v-5h-5" /></>);
export const IconLock = make(<><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>);
