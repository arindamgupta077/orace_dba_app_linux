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
    <html lang="en" suppressHydrationWarning>
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
        {/*
          No-flash theme bootstrap: apply the saved theme class to <html>
          before React hydrates so the very first paint matches the
          user's preference (stored in localStorage by ThemeProvider).
          Defaults to "light" when no preference exists yet.
        */}
        <Script id="apply-theme-pre-hydration" strategy="beforeInteractive">
          {`(function(){
  try {
    var p = window.location.pathname;
    var isAuthPage = p === "/login" || p === "/forgot-password" || p === "/reset-password" || p === "/first-login-reset";
    var t = isAuthPage ? "light" : (localStorage.getItem("dba-theme") || "light");
    if (t !== "light" && t !== "dark") t = "light";
    var root = document.documentElement;
    if (t === "dark") root.classList.add("dark"); else root.classList.remove("dark");
    root.style.colorScheme = t;
  } catch (e) {
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "light";
  }
})();`}
        </Script>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
