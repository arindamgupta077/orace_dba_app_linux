"use client";

import { UserCog, Users, Fingerprint, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserAccountSection } from "@/components/user-management/user-account-section";
import { ProfileManagementSection } from "@/components/user-management/profile-section";
import { PrivilegeManagementSection } from "@/components/user-management/privilege-section";

export default function UserManagementPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="User Management"
        description="Manage Oracle database users, profiles, and privileges. All operations are executed via n8n with automatic confirmation queries."
        icon={UserCog}
      />

      <Tabs defaultValue="account" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 lg:w-auto lg:inline-flex">
          <TabsTrigger value="account" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            <span>Account Management</span>
          </TabsTrigger>
          <TabsTrigger value="profile" className="flex items-center gap-2">
            <Fingerprint className="h-4 w-4" />
            <span>Profile Management</span>
          </TabsTrigger>
          <TabsTrigger value="privileges" className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            <span>Privilege Management</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="account" className="mt-0">
          <div className="rounded-lg border border-border/60 bg-card/30 p-5 space-y-4">
            <div>
              <h2 className="text-base font-semibold">User Account Management</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Create, unlock, reset passwords, reassign tablespaces and profiles, change quotas, rename, and drop Oracle database users.
                Usernames for operations are fetched from n8n via <code className="text-cyan-400">schema_list</code>.
              </p>
            </div>
            <UserAccountSection />
          </div>
        </TabsContent>

        <TabsContent value="profile" className="mt-0">
          <div className="rounded-lg border border-border/60 bg-card/30 p-5 space-y-4">
            <div>
              <h2 className="text-base font-semibold">Profile Management</h2>
              <p className="text-sm text-muted-foreground mt-1">
                View, create, alter, and drop Oracle profiles. Profiles control resource limits and password policies for database users.
              </p>
            </div>
            <ProfileManagementSection />
          </div>
        </TabsContent>

        <TabsContent value="privileges" className="mt-0">
          <div className="rounded-lg border border-border/60 bg-card/30 p-5 space-y-4">
            <div>
              <h2 className="text-base font-semibold">Privilege Management</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Grant or revoke system privileges, object privileges, create Oracle roles, and assign roles to users.
                Users and objects are fetched dynamically from n8n.
              </p>
            </div>
            <PrivilegeManagementSection />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
