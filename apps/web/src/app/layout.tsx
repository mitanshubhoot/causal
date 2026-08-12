import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

// The whole UI leans on font-mono for eyebrows, badges, and trace metadata.
// Without loading it, every mono call site fell back to Courier.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains",
  display: "swap",
});

const SITE_URL = process.env["NEXT_PUBLIC_SITE_URL"] ?? "https://causal-demo.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Causal — AI-native observability and self-healing for AI agents",
  description:
    "Causal traces every LLM and tool call, detects failures with an LLM judge, root-causes each incident to the exact commit, and opens a verified fix PR. Observe, detect, heal.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
  openGraph: {
    title: "Causal — AI-native observability and self-healing for AI agents",
    description: "Trace every agent run, catch every failure, and ship the fix — automatically.",
    type: "website",
    url: SITE_URL,
    siteName: "Causal",
  },
  twitter: {
    card: "summary_large_image",
    title: "Causal — AI-native observability and self-healing for AI agents",
    description: "Trace every agent run, catch every failure, and ship the fix — automatically.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} scroll-smooth h-full`}>
      <body className={`${inter.className} bg-black text-gray-100 antialiased h-full`}>
        {children}
      </body>
    </html>
  );
}
