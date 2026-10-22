import { Suspense } from "react";
import { AiLinksRegressionDiagnostics } from "@/components/diagnostics/ai-links-regression-diagnostics";

export default function AiLinksRegressionDiagnosticsPage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Preparing AI links diagnostics...</div>}>
      <AiLinksRegressionDiagnostics />
    </Suspense>
  );
}
