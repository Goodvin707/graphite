import type { Metadata } from "next";
import { Literata, Manrope } from "next/font/google";
import "./globals.css";

const sans = Manrope({
  subsets: ["latin", "cyrillic"],
  variable: "--font-manrope",
  display: "swap",
});

const serif = Literata({
  subsets: ["latin", "cyrillic"],
  variable: "--font-literata",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Нить — заметки и граф связей",
  description:
    "Бесплатное локальное хранилище заметок с интерактивным графом. Ссылки [[так]] становятся рёбрами. Данные остаются в браузере.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className={`${sans.variable} ${serif.variable} dark h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
