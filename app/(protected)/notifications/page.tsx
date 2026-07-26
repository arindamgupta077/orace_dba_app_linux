import { Metadata } from "next";
import { Suspense } from "react";
import { NotificationCenter } from "@/components/notifications/notification-center";

export const metadata: Metadata = {
  title: "Notification Center | ITSS DBA Portal",
  description: "Complete historical archive of database alerts, monitoring incidents & DBA console activities."
};

export default function NotificationsPage() {
  return (
    <div className="w-full max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading Notification Center...</div>}>
        <NotificationCenter />
      </Suspense>
    </div>
  );
}
