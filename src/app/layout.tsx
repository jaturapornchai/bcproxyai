import type { Metadata } from "next";
import { Geist, Geist_Mono, IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Geist has no Thai glyphs — the browser falls back per-glyph to Plex Thai.
const plexThai = IBM_Plex_Sans_Thai({
  variable: "--font-thai",
  subsets: ["thai"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "BCAiRouter — AI Gateway ฟรี",
  description: "Smart AI Gateway — เลือก model ฟรีที่ดีที่สุดให้อัตโนมัติ สำหรับ OpenClaw และ HiClaw",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="th"
      className={`${geistSans.variable} ${geistMono.variable} ${plexThai.variable} h-full antialiased`}
    >
      <body className="min-h-full text-gray-100">
        <div className="bg-aurora" aria-hidden />
        <div className="bg-grid" aria-hidden />
        {children}
      </body>
    </html>
  );
}
