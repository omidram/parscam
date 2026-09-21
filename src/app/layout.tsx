import type { Metadata } from "next";
import { Vazirmatn } from "next/font/google";
import { SettingsProvider } from "@/lib/settings";
import "./globals.css";

const vazirmatn = Vazirmatn({
  subsets: ["arabic"],
  variable: "--font-vazirmatn",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "پارس‌کم | سامانه بومی نظارت تصویری",
    template: "%s | پارس‌کم",
  },
  description:
    "پارس‌کم سامانه کاملاً ایرانی نظارت تصویری برای مدیریت دوربین، هشدار و ضبط.",
  icons: {
    icon: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fa"
      dir="rtl"
      data-scroll-behavior="smooth"
      className={`${vazirmatn.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=JSON.parse(localStorage.getItem('parscam-settings-v1')||'{}');var t=s.theme||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');document.documentElement.dataset.theme=d?'dark':'light';if(s.accentStyle)document.documentElement.dataset.accent=s.accentStyle;if(s.density)document.documentElement.dataset.density=s.density;}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full antialiased">
        <SettingsProvider>{children}</SettingsProvider>
      </body>
    </html>
  );
}
