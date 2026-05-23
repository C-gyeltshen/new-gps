import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import HeaderActions from "./HeaderActions";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Track Net Bhutan",
  description: "GPS Tracker | Stay Connected, Stay Secure",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-50 shadow-md" style={{ background: 'linear-gradient(135deg, #7A0000 0%, #B22222 55%, #EF6C00 100%)' }}>
          <div className="max-w-5xl mx-auto px-4 sm:px-8 h-16 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Track Net Bhutan" width={40} height={40} className="rounded-lg object-contain bg-white p-0.5" />
            <div className="flex flex-col leading-tight">
              <span className="text-white font-bold text-base tracking-tight">Track Net Bhutan</span>
              <span className="text-[10px] hidden sm:block" style={{ color: 'var(--orange)' }}>
                GPS Tracker · Stay Connected, Stay Secure
              </span>
            </div>
            <div className="ml-auto">
              <HeaderActions />
            </div>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
