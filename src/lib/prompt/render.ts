import { resolvePromptContext } from "@/lib/prompt/context";
import type {
  PromptContextValues,
  PromptTemplate,
  RenderedPromptTemplate,
} from "@/lib/prompt/types";
import type { Locale } from "@/types/settings";

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
  locale: Locale = "en-US",
): RenderedPromptTemplate {
  const resolution = resolvePromptContext(template, values, locale);

  return {
    renderedSystemPrompt: renderTemplateString(template.systemPrompt, resolution.values),
    renderedPrompt: renderTemplateString(template.userPrompt, resolution.values) ?? "",
    contextSummary: resolution.contextSummary,
    missingRequiredContext: resolution.missingRequiredContext,
    missingOptionalContext: resolution.missingOptionalContext,
    values: resolution.values,
  };
}
