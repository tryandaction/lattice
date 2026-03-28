import { resolvePromptContext } from "@/lib/prompt/context";
import type {
  PromptContextValues,
  PromptTemplate,
  RenderedPromptTemplate,
} from "@/lib/prompt/types";

const SLOT_PATTERN = /{{\s*([a-z_]+)\s*}}/g;

function renderTemplateString(template: string | undefined, values: PromptContextValues): string | undefined {
  if (!template) {
    return undefined;
  }

  return template.replace(SLOT_PATTERN, (_, slotName: keyof PromptContextValues) => values[slotName] ?? "");
}

export function renderPromptTemplate(
  template: PromptTemplate,
  values: PromptContextValues,
): RenderedPromptTemplate {
  const resolution = resolvePromptContext(template, values);

  return {
    renderedSystemPrompt: renderTemplateString(template.systemPrompt, resolution.values),
    renderedPrompt: renderTemplateString(template.userPrompt, resolution.values) ?? "",
    contextSummary: resolution.contextSummary,
    missingRequiredContext: resolution.missingRequiredContext,
    missingOptionalContext: resolution.missingOptionalContext,
    values: resolution.values,
  };
}
