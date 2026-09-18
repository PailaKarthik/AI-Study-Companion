import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "@/styles/globals.css";
import { Toaster } from "@/components/shared/toaster";
import { QueryProvider } from "@/providers/query-provider";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AI Study Companion",
  description: "Learn anything deeply — spaces, projects, materials, AI tutor, quizzes and growth.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={outfit.variable}>
      <body className="font-sans">
        <QueryProvider>
          {children}
          <Toaster />
        </QueryProvider>
      </body>
    </html>
  );
}
