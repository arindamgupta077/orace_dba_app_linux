import type { Metadata } from "next";
import Script from "next/script";
import { AppProviders } from "@/components/providers/app-providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "ITSS Database management portal",
  description: "Enterprise Oracle database administration and operations portal."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Script id="strip-bis-skin-checked" strategy="beforeInteractive">
          {`(() => {
  const ATTR = "bis_skin_checked";
  const cleanNode = (node) => {
    if (!(node instanceof Element)) return;
    if (node.hasAttribute(ATTR)) node.removeAttribute(ATTR);
    node.querySelectorAll?.("[" + ATTR + "]").forEach((el) => el.removeAttribute(ATTR));
  };
  cleanNode(document.documentElement);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        cleanNode(mutation.target);
        continue;
      }
      mutation.addedNodes.forEach(cleanNode);
    }
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [ATTR]
  });
})();`}
        </Script>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
