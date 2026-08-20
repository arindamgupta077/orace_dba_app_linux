import type { Metadata } from "next";
import { AppProviders } from "@/components/providers/app-providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "ITSS Database management portal",
  description: "Enterprise Oracle database administration and operations portal."
};

const STRIP_BIS_SKIN_SCRIPT = `(() => {
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
})();`;

const APPLY_THEME_SCRIPT = `(function(){
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
})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: STRIP_BIS_SKIN_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: APPLY_THEME_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
