"use client";

import { useState } from "react";
import { Database } from "lucide-react";
import { ActionCard } from "@/components/action/action-card";
import { ActionRunnerModal } from "@/components/action/action-runner-modal";
import { PageHeader } from "@/components/layout/page-header";
import { TablespaceAlertsPanel } from "@/components/visual/tablespace-alerts-panel";
import { TablespaceRunPanel } from "@/components/visual/tablespace-run-panel";
import { DatafileExtendPanel } from "@/components/visual/datafile-extend-modal";
import { getActionDefinition } from "@/lib/action-catalog";
import type { DbaActionDefinition, DbaResponse } from "@/types/dba";

const TABLESPACE_ACTIONS: DbaActionDefinition[] = [
  getActionDefinition("tablespace_check")!,
  getActionDefinition("create_tablespace")!
];

export default function TablespacesPage() {
  const [activeDefinition, setActiveDefinition] = useState<DbaActionDefinition | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_response, setResponse] = useState<DbaResponse | null>(null);

  const openAction = (definition: DbaActionDefinition) => {
    setActiveDefinition(definition);
    setModalOpen(true);
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Tablespace Management"
        description="Monitor utilization, create tablespaces, extend datafiles, and review storage alerts."
        icon={Database}
      />

      {/* ── Action Cards ─────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Actions
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {TABLESPACE_ACTIONS.map((def) => (
            <ActionCard key={def.action} definition={def} onRun={openAction} />
          ))}
        </div>
      </section>

      {/* ── Datafile Extension ───────────────────────────────── */}
      <section>
        <DatafileExtendPanel />
      </section>

      {/* ── Storage Alerts ───────────────────────────────────── */}
      <section>
        <TablespaceAlertsPanel />
      </section>

      {/* ── Utilization Report ───────────────────────────────── */}
      <section>
        <TablespaceRunPanel />
      </section>

      <ActionRunnerModal
        definition={activeDefinition}
        open={modalOpen}
        onOpenChange={setModalOpen}
        onComplete={setResponse}
      />
    </div>
  );
}
