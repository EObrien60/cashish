type P = { className?: string };
const base = "h-5 w-5";

function Svg({ children, className }: P & { children: React.ReactNode }) {
  return (
    <svg
      className={className ?? base}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const IconDashboard = (p: P) => (
  <Svg {...p}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></Svg>
);
export const IconLedger = (p: P) => (
  <Svg {...p}><path d="M4 4h16v16H4z" /><path d="M8 4v16M4 9h4M4 14h4" /></Svg>
);
export const IconInvoice = (p: P) => (
  <Svg {...p}><path d="M6 2h9l5 5v15H6z" /><path d="M14 2v6h6" /><path d="M9 13h6M9 17h6M9 9h2" /></Svg>
);
export const IconUsers = (p: P) => (
  <Svg {...p}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 5.5a3 3 0 0 1 0 5.8M17 20a5.5 5.5 0 0 0-2.2-4.4" /></Svg>
);
export const IconBox = (p: P) => (
  <Svg {...p}><path d="M21 8 12 3 3 8l9 5 9-5Z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></Svg>
);
export const IconReport = (p: P) => (
  <Svg {...p}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></Svg>
);
export const IconVat = (p: P) => (
  <Svg {...p}><circle cx="8" cy="8" r="2.5" /><circle cx="16" cy="16" r="2.5" /><path d="M5 19 19 5" /></Svg>
);
export const IconSettings = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1A2 2 0 1 1 7 3.5l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" /></Svg>
);
export const IconUpload = (p: P) => (
  <Svg {...p}><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></Svg>
);
export const IconPlus = (p: P) => (<Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>);
export const IconTrash = (p: P) => (<Svg {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></Svg>);
export const IconPrint = (p: P) => (<Svg {...p}><path d="M6 9V3h12v6" /><rect x="4" y="9" width="16" height="8" rx="1.5" /><path d="M8 17h8v4H8z" /></Svg>);
export const IconCheck = (p: P) => (<Svg {...p}><path d="M5 13l4 4L19 7" /></Svg>);
export const IconArrowDown = (p: P) => (<Svg {...p}><path d="M12 5v14M19 12l-7 7-7-7" /></Svg>);
export const IconArrowUp = (p: P) => (<Svg {...p}><path d="M12 19V5M5 12l7-7 7 7" /></Svg>);
export const IconSearch = (p: P) => (<Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></Svg>);
export const IconEdit = (p: P) => (<Svg {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></Svg>);
export const IconChevron = (p: P) => (<Svg {...p}><path d="m9 18 6-6-6-6" /></Svg>);
export const IconCoins = (p: P) => (<Svg {...p}><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></Svg>);
export const IconRules = (p: P) => (<Svg {...p}><path d="M4 7h10M4 12h16M4 17h7" /><circle cx="18" cy="7" r="2" /><circle cx="15" cy="17" r="2" /></Svg>);
export const IconPaperclip = (p: P) => (<Svg {...p}><path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L10 18.3a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" /></Svg>);
export const IconRepeat = (p: P) => (<Svg {...p}><path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></Svg>);
export const IconPause = (p: P) => (<Svg {...p}><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></Svg>);
export const IconPlay = (p: P) => (<Svg {...p}><path d="M7 4v16l13-8z" /></Svg>);
export const IconWand = (p: P) => (<Svg {...p}><path d="m15 4 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z" /><path d="M4 20 14 10" /><path d="m13 7 4 4" /></Svg>);
export const IconFile = (p: P) => (<Svg {...p}><path d="M6 2h9l5 5v15H6z" /><path d="M14 2v6h6" /></Svg>);
