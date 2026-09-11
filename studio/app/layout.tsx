import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Shell } from "@/components/shell";
import { TooltipProvider } from "@/components/ui/misc";
import { StudioProvider } from "@/lib/studio-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Video Studio",
  description: "Internal production studio over AIContentPipeline",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <StudioProvider>
          <TooltipProvider>
            <Shell>{children}</Shell>
          </TooltipProvider>
        </StudioProvider>
      </body>
    </html>
  );
}
