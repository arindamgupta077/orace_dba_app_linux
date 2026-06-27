"use client";

import { useState } from "react";
import { HardDrive } from "lucide-react";
import { ActionCard } from "@/components/action/action-card";
import { ActionRunnerModal } from "@/components/action/action-runner-modal";
import { PageHeader } from "@/components/layout/page-header";
import { FilesystemDriveAlertsPanel } from "@/components/visual/filesystem-drive-alerts-panel";
import { getActionDefinition } from "@/lib/action-catalog";
import { useAppStore } from "@/store/use-app-store";
import type { DbaActionDefinition } from "@/types/dba";

export default function FilesystemDrivePage() {
  const selectedDb = useAppStore((state) => state.selectedDb);
  const databases = useAppStore((state) => state.databases);
  const [activeDefinition, setActiveDefinition] = useState<DbaActionDefinition | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const selectedTarget = databases.find((db) => db.name === selectedDb);
  const isWindows = selectedTarget?.os === "Windows";
  const sectionName = isWindows ? "Drive utilization" : "Filesystem utilization";
  const targetLabel = isWindows ? "drive" : "filesystem";
  const baseAction = getActionDefinition("disk_utilization")!;
  const action = {
    ...baseAction,
    title: `Check ${isWindows ? "Drive" : "Filesystem"} utilization status`,
    description: `Run an on-demand ${targetLabel} utilization check through n8n SSH automation.`
  };

  const openAction = (definition: DbaActionDefinition) => {
    setActiveDefinition(definition);
    setModalOpen(true);
  };

  return (
    <>
      <PageHeader
        title={sectionName}
        description={`Monitor ${targetLabel} usage, acknowledge threshold alerts, and run on-demand utilization checks for ${selectedDb}.`}
        icon={HardDrive}
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_minmax(280px,380px)]">
        <FilesystemDriveAlertsPanel />
        <div>
          <ActionCard definition={action} onRun={openAction} />
        </div>
      </div>

      <ActionRunnerModal definition={activeDefinition} open={modalOpen} onOpenChange={setModalOpen} />
    </>
  );
}
