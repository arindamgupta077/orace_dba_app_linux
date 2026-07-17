"use client";

import { useState } from "react";
import { Database, FolderPlus, HardDriveDownload, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ActionRunnerModal } from "@/components/action/action-runner-modal";
import { PageHeader } from "@/components/layout/page-header";
import { TablespaceAlertsPanel } from "@/components/visual/tablespace-alerts-panel";
import { TablespaceRunPanel } from "@/components/visual/tablespace-run-panel";
import { DatafileExtendPanel, DatafileExtendModal } from "@/components/visual/datafile-extend-modal";
import { getActionDefinition } from "@/lib/action-catalog";
import type { DbaActionDefinition, DbaResponse } from "@/types/dba";

const TABLESPACE_CHECK = getActionDefinition("tablespace_check")!;
const CREATE_TABLESPACE = getActionDefinition("create_tablespace")!;

export default function TablespacesPage() {
  const [activeDefinition, setActiveDefinition] = useState<DbaActionDefinition | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_response, setResponse] = useState<DbaResponse | null>(null);
  const [datafileModalOpen, setDatafileModalOpen] = useState(false);

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

      {/* ── 1. Tablespace Notifications (top) ──────────────────── */}
      <section>
        <TablespaceAlertsPanel />
      </section>

      {/* ── 2. Three equal action cards ────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Actions
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* Tablespace Check */}
          <Card className="flex h-full flex-col">
            <CardContent className="flex flex-1 flex-col p-5">
              <div className="flex items-start gap-3">
                <span className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 p-2.5 text-cyan-200">
                  <Database className="h-5 w-5" />
                </span>
              </div>
              <div className="mt-4 flex-1">
                <p className="text-base font-semibold">{TABLESPACE_CHECK.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {TABLESPACE_CHECK.description}
                </p>
              </div>
              <Button
                className="mt-5 w-full"
                variant="outline"
                onClick={() => openAction(TABLESPACE_CHECK)}
              >
                <Play className="mr-1.5 h-3.5 w-3.5" />
                Run Action
              </Button>
            </CardContent>
          </Card>

          {/* Create Tablespace */}
          <Card className="flex h-full flex-col">
            <CardContent className="flex flex-1 flex-col p-5">
              <div className="flex items-start gap-3">
                <span className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-2.5 text-emerald-200">
                  <FolderPlus className="h-5 w-5" />
                </span>
              </div>
              <div className="mt-4 flex-1">
                <p className="text-base font-semibold">{CREATE_TABLESPACE.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {CREATE_TABLESPACE.description}
                </p>
              </div>
              <Button
                className="mt-5 w-full"
                variant="outline"
                onClick={() => openAction(CREATE_TABLESPACE)}
              >
                <Play className="mr-1.5 h-3.5 w-3.5" />
                Run Action
              </Button>
            </CardContent>
          </Card>

          {/* AI-Assisted Datafile Extension */}
          <Card className="flex h-full flex-col">
            <CardContent className="flex flex-1 flex-col p-5">
              <div className="flex items-start gap-3">
                <span className="rounded-lg border border-violet-400/30 bg-violet-400/10 p-2.5 text-violet-200">
                  <HardDriveDownload className="h-5 w-5" />
                </span>
              </div>
              <div className="mt-4 flex-1">
                <p className="text-base font-semibold">AI-Assisted Datafile Extension</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Extend datafiles with AI-generated SQL. 4-step workflow: fetch tablespaces, select
                  target, review AI SQL, and execute.
                </p>
              </div>
              <Button
                className="mt-5 w-full"
                variant="outline"
                onClick={() => setDatafileModalOpen(true)}
              >
                <Play className="mr-1.5 h-3.5 w-3.5" />
                Run Action
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── 3. Datafile Extension Active Operations ─────────────── */}
      <section>
        <DatafileExtendPanel />
      </section>

      {/* ── 4. Utilization Report ───────────────────────────────── */}
      <section>
        <TablespaceRunPanel />
      </section>

      <ActionRunnerModal
        definition={activeDefinition}
        open={modalOpen}
        onOpenChange={setModalOpen}
        onComplete={setResponse}
      />

      {/* Standalone datafile extend modal triggered from the action card */}
      <DatafileExtendModal
        open={datafileModalOpen}
        onOpenChange={setDatafileModalOpen}
      />
    </div>
  );
}
