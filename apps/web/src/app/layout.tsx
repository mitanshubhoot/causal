import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Causal — Root Cause Intelligence for AI Agents",
  description:
    "Trace production incidents back through agent reasoning, code, and specs in 2 minutes instead of 2 days.",
  openGraph: {
    title: "Causal — Root Cause Intelligence",
    description: "Trace production incidents back through agent reasoning in 2 minutes.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} scroll-smooth`}>
      <body className={`${inter.className} bg-[#030303] text-gray-100 antialiased`}>
        {children}
      </body>
    </html>
  );
}
