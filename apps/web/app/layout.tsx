import React from "react";
import type { ReactNode } from "react";

export const metadata = {
  title: "WPT",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): React.ReactElement {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
