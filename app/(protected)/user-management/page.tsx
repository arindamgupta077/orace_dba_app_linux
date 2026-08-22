"use client";

import { UserCog, Users, Fingerprint, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserAccountSection } from "@/components/user-management/user-account-section";
import { ProfileManagementSection } from "@/components/user-management/profile-section";
import { PrivilegeManagementSection } from "@/components/user-management/privilege-section";
import { cn } from "@/lib/utils";

/* ── Per-tab accent styling (static class strings for Tailwind JIT) ── */

const TAB_ACCENTS = {
  account: {
    trigger:
      "data-[state=active]:border-cyan-500/40 data-[state=active]:bg-cyan-500/10 data-[state=active]:text-cyan-700 dark:data-[state=active]:text-cyan-300",
    chip: "group-data-[state=active]:from-cyan-500 group-data-[state=active]:to-blue-600"
  },
  profile: {
    trigger:
      "data-[state=active]:border-violet-500/40 data-[state=active]:bg-violet-500/10 data-[state=active]:text-violet-700 dark:data-[state=active]:text-violet-300",
    chip: "group-data-[state=active]:from-violet-500 group-data-[state=active]:to-purple-600"
  },
  privileges: {
    trigger:
      "data-[state=active]:border-emerald-500/40 data-[state=active]:bg-emerald-500/10 data-[state=active]:text-emerald-700 dark:data-[state=active]:text-emerald-300",
    chip: "group-data-[state=active]:from-emerald-500 group-data-[state=active]:to-teal-600"
  }
} as const;

export default function UserManagementPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="User Management"
        description="Manage Oracle database users, profiles, and privileges."
        icon={UserCog}
      />

      <Tabs defaultValue="account" className="space-y-5">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-2 rounded-xl border border-border/60 bg-muted/20 p-1.5 lg:w-auto lg:inline-flex">
          <TabsTrigger
            value="account"
            className={cn(
              "group flex flex-1 items-center justify-center gap-2.5 rounded-lg border border-transparent px-4 py-2.5 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-background/50 hover:text-foreground data-[state=active]:bg-background data-[state=active]:shadow-sm sm:flex-none",
              TAB_ACCENTS.account.trigger
            )}
          >
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-all group-data-[state=active]:bg-gradient-to-br group-data-[state=active]:text-white group-data-[state=active]:shadow-sm",
                TAB_ACCENTS.account.chip
              )}
            >
              <Users className="h-3.5 w-3.5" />
            </span>
            <span>Account Management</span>
          </TabsTrigger>
          <TabsTrigger
            value="profile"
            className={cn(
              "group flex flex-1 items-center justify-center gap-2.5 rounded-lg border border-transparent px-4 py-2.5 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-background/50 hover:text-foreground data-[state=active]:bg-background data-[state=active]:shadow-sm sm:flex-none",
              TAB_ACCENTS.profile.trigger
            )}
          >
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-all group-data-[state=active]:bg-gradient-to-br group-data-[state=active]:text-white group-data-[state=active]:shadow-sm",
                TAB_ACCENTS.profile.chip
              )}
            >
              <Fingerprint className="h-3.5 w-3.5" />
            </span>
            <span>Profile Management</span>
          </TabsTrigger>
          <TabsTrigger
            value="privileges"
            className={cn(
              "group flex flex-1 items-center justify-center gap-2.5 rounded-lg border border-transparent px-4 py-2.5 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-background/50 hover:text-foreground data-[state=active]:bg-background data-[state=active]:shadow-sm sm:flex-none",
              TAB_ACCENTS.privileges.trigger
            )}
          >
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-all group-data-[state=active]:bg-gradient-to-br group-data-[state=active]:text-white group-data-[state=active]:shadow-sm",
                TAB_ACCENTS.privileges.chip
              )}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
            </span>
            <span>Privilege Management</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="account" className="mt-0">
          <UserAccountSection />
        </TabsContent>

        <TabsContent value="profile" className="mt-0">
          <ProfileManagementSection />
        </TabsContent>

        <TabsContent value="privileges" className="mt-0">
          <PrivilegeManagementSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
