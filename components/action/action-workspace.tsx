"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { RefreshCcw } from "lucide-react";
import { ActionCard } from "@/components/action/action-card";
import { ActionRunnerModal } from "@/components/action/action-runner-modal";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AIInsightPanel } from "@/components/visual/ai-insight-panel";
import { TablespaceChart } from "@/components/visual/tablespace-chart";
import { SessionTable } from "@/components/visual/session-table";
import { SQLGrid } from "@/components/visual/sql-grid";
import { LockTreeView } from "@/components/visual/lock-tree-view";
import { StructuredDataViews } from "@/components/visual/structured-data-views";
import { TerminalViewer } from "@/components/visual/terminal-viewer";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { getActionDefinition } from "@/lib/action-catalog";
import { useAppStore } from "@/store/use-app-store";
import type { DbaAction, DbaActionDefinition, DbaResponse, SessionRow } from "@/types/dba";

interface ActionWorkspaceProps {
  title: string;
  description: string;
  icon: LucideIcon;
  primaryAction: DbaAction;
  actions: DbaActionDefinition[];
  children?: ReactNode;
  /** When true, hides AI summary / findings / recommendations and terminal output from the inline response section. */
  hideInsights?: boolean;
  /** Extra grid cells rendered after the action cards (e.g. custom workflow panels). */
  extraCards?: ReactNode;
}

export function ActionWorkspace({ title, description, icon, primaryAction, actions, children, hideInsights = false, extraCards }: ActionWorkspaceProps) {
  const [activeDefinition, setActiveDefinition] = useState<DbaActionDefinition | null>(null);
  const [activeInitialParams, setActiveInitialParams] = useState<Record<string, unknown> | undefined>();
  const [modalOpen, setModalOpen] = useState(false);
  const [response, setResponse] = useState<DbaResponse | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const autoRefreshSeconds = useAppStore((state) => state.autoRefreshSeconds);
  const setAutoRefreshSeconds = useAppStore((state) => state.setAutoRefreshSeconds);

  const openAction = (definition: DbaActionDefinition, initialParams?: Record<string, unknown>) => {
    setActiveDefinition({ ...definition, params: definition.params });
    setActiveInitialParams(initialParams);
    setModalOpen(true);
  };

  useAutoRefresh(autoRefresh, autoRefreshSeconds, () => {
    const definition = getActionDefinition(primaryAction);
    if (definition) openAction(definition);
  });

  const killSession = (row: SessionRow) => {
    const definition = getActionDefinition("kill_session");
    if (definition) {
      openAction(definition, {
        sid: row.sid,
        serial: row.serial,
        reason: `Terminate session ${row.sid},${row.serial} from ${row.username}`
      });
    }
  };

  const tablespaces = response?.raw_data.tablespaces || [];
  const sessions = response?.raw_data.sessions || [];
  const sql = response?.raw_data.sql || [];
  const locks = response?.raw_data.locks || [];

  return (
    <div>
      <PageHeader title={title} description={description} icon={icon} actionLabel="Run Primary Check" onAction={() => openAction(getActionDefinition(primaryAction)!)} />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Button variant={autoRefresh ? "neon" : "outline"} onClick={() => setAutoRefresh((value) => !value)}>
          <RefreshCcw className="h-4 w-4" />
          Auto Refresh
        </Button>
        <Select value={String(autoRefreshSeconds)} onValueChange={(value) => setAutoRefreshSeconds(Number(value))}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[30, 60, 120, 300].map((value) => (
              <SelectItem key={value} value={String(value)}>
                {value}s
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {actions.map((definition) => (
          <ActionCard key={definition.action} definition={definition} onRun={openAction} />
        ))}
        {extraCards}
      </div>

      {children ? <div className="mt-6">{children}</div> : null}

      {response ? (
        <div className="mt-6 space-y-5">
          {!hideInsights && <AIInsightPanel summary={response.ai_summary} status={response.db_status} findings={response.findings} recommendations={response.recommendations} />}
          {tablespaces.length ? <TablespaceChart rows={tablespaces} /> : null}
          {sessions.length ? <SessionTable rows={sessions} onKill={killSession} /> : null}
          {sql.length ? <SQLGrid rows={sql} /> : null}
          {locks.length ? <LockTreeView rows={locks} /> : null}
          {!hideInsights && <StructuredDataViews response={response} onRunAction={openAction} getDefinition={getActionDefinition} />}
          {!hideInsights && <TerminalViewer output={response.raw_output} />}
        </div>
      ) : null}

      <ActionRunnerModal definition={activeDefinition} open={modalOpen} onOpenChange={setModalOpen} onComplete={setResponse} initialParams={activeInitialParams} />
    </div>
  );
}
