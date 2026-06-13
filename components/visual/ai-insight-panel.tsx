import { BrainCircuit, CheckCircle2, Lightbulb, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/visual/status-badge";
import type { DbaFinding, DbaRecommendation, DbaStatus } from "@/types/dba";

interface AIInsightPanelProps {
  summary: string;
  status: DbaStatus;
  findings?: DbaFinding[];
  recommendations?: DbaRecommendation[];
}

export function AIInsightPanel({ summary, status, findings = [], recommendations = [] }: AIInsightPanelProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="rounded-md border border-cyan-400/30 bg-cyan-400/10 p-2 text-cyan-200">
            <BrainCircuit className="h-5 w-5" />
          </span>
          <div>
            <CardTitle>AI DBA Summary</CardTitle>
            <p className="text-sm text-muted-foreground">n8n analysis result</p>
          </div>
        </div>
        <StatusBadge status={status} />
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="rounded-md border border-border/70 bg-background/40 p-4 text-sm leading-6 text-slate-200">{summary}</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <TriangleAlert className="h-4 w-4 text-amber-300" />
              Findings
            </div>
            {findings.slice(0, 4).map((finding, index) => (
              <div
                key={finding.id || `${finding.title || "finding"}-${finding.value || "na"}-${index}`}
                className="rounded-md border border-border/70 bg-secondary/30 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium">{finding.title}</p>
                  <StatusBadge status={finding.severity} />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{finding.detail}</p>
              </div>
            ))}
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Lightbulb className="h-4 w-4 text-cyan-300" />
              Recommendations
            </div>
            {recommendations.slice(0, 4).map((recommendation, index) => (
              <div
                key={recommendation.id || `${recommendation.title || "recommendation"}-${recommendation.action || "na"}-${index}`}
                className="rounded-md border border-border/70 bg-secondary/30 p-3"
              >
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-300" />
                  <div>
                    <p className="text-sm font-medium">{recommendation.title}</p>
                    <p className="mt-2 text-sm text-muted-foreground">{recommendation.detail}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
