import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bharat Gas Message Center | LPG Customer Communication",
  description: "Enterprise WhatsApp personalized customer communication & refill broadcast portal for Bharat Gas agencies.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-white text-[#212529]">{children}</body>
    </html>
  );
}
