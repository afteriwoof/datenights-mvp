import "./globals.css";

export const metadata = {
  title: "Date Nights",
  description: "A private timeline of your date nights.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
