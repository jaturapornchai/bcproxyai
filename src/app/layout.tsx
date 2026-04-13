import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SMLGateway — AI Gateway ฟรี",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-gray-950 text-gray-100 scanlines">
        {children}
      </body>
    </html>
  );
}
