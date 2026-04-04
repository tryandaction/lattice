import { create } from "zustand";
import { BUILTIN_PROMPT_TEMPLATES } from "@/lib/prompt/builtin-templates";
import type {
  PromptRun,
  PromptSurface,
  PromptTemplate,
  PromptWorkspacePreference,
} from "@/lib/prompt/types";
import { getStorageAdapter } from "@/lib/storage-adapter";

const PROMPT_TEMPLATE_STORAGE_KEY = "lattice-prompt-templates";
const MAX_PROMPT_RUNS = 60;
const MAX_RECENT_TEMPLATE_IDS = 8;

interface PersistedPromptTemplateState {
  userTemplates: PromptTemplate[];
  runs: PromptRun[];
  workspacePreferences: Record<string, PromptWorkspacePreference>;
}

interface PromptTemplateState extends PersistedPromptTemplateState {
  isLoaded: boolean;
}

interface PromptTemplateActions {
  loadPromptState: () => Promise<void>;
  upsertTemplate: (template: Partial<PromptTemplate> & Pick<PromptTemplate, "title" | "category" | "userPrompt" | "surfaces" | "outputMode">) => PromptTemplate;
  deleteTemplate: (templateId: string) => void;
  addRun: (run: Omit<PromptRun, "id" | "createdAt">) => string;
  updateRunResult: (runId: string, result: Partial<Pick<PromptRun, "resultMessageId" | "resultDraftId" | "resultProposalId">>) => void;
  rememberTemplateUsage: (
    templateId: string,
    surface: PromptSurface,
    workspaceIdentity?: { workspaceKey?: string | null; workspaceRootPath?: string | null } | null,
  ) => void;
  getTemplatesForSurface: (surface: PromptSurface) => PromptTemplate[];
  getTemplateById: (templateId: string) => PromptTemplate | null;
  getRecentTemplates: (
    surface: PromptSurface,
    workspaceIdentity?: { workspaceKey?: string | null; workspaceRootPath?: string | null } | null,
  ) => PromptTemplate[];
  getRecentRuns: (surface?: PromptSurface) => PromptRun[];
}

const DEFAULT_PREFERENCE: PromptWorkspacePreference = {
  recentTemplateIds: [],
  defaultTemplatesBySurface: {},
};

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getWorkspacePreferenceKey(input?: { workspaceKey?: string | null; workspaceRootPath?: string | null } | null): string {
  const workspaceKey = input?.workspaceKey?.trim();
  if (workspaceKey) {
    return workspaceKey;
  }
  return input?.workspaceRootPath?.trim() || "__global__";
}

function getWorkspacePreferenceCandidates(input?: { workspaceKey?: string | null; workspaceRootPath?: string | null } | null): string[] {
  const candidates = [
    input?.workspaceKey?.trim() || null,
    input?.workspaceRootPath?.trim() || null,
    "__global__",
  ].filter((value): value is string => Boolean(value));
  return Array.from(new Set(candidates));
}

function normalizeUserTemplate(template: PromptTemplate): PromptTemplate {
  return {
    ...template,
    pinned: Boolean(template.pinned),
    builtin: false,
    preferredProvider: template.preferredProvider ?? null,
    preferredModel: template.preferredModel ?? null,
  };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedSave(state: PersistedPromptTemplateState) {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }

  saveTimer = setTimeout(async () => {
    try {
      const storage = getStorageAdapter();
      await storage.set(PROMPT_TEMPLATE_STORAGE_KEY, state);
    } catch (error) {
      console.error("Failed to save prompt templates:", error);
    }
  }, 300);
}

export const usePromptTemplateStore = create<PromptTemplateState & PromptTemplateActions>((set, get) => ({
  isLoaded: false,
  userTemplates: [],
  runs: [],
  workspacePreferences: {},

  loadPromptState: async () => {
    if (get().isLoaded) {
      return;
    }

    try {
      const storage = getStorageAdapter();
      const saved = await storage.get<PersistedPromptTemplateState>(PROMPT_TEMPLATE_STORAGE_KEY);
      set({
        isLoaded: true,
        userTemplates: (saved?.userTemplates ?? []).map(normalizeUserTemplate),
        runs: saved?.runs ?? [],
        workspacePreferences: saved?.workspacePreferences ?? {},
      });
    } catch (error) {
      console.error("Failed to load prompt templates:", error);
      set({ isLoaded: true });
    }
  },

  upsertTemplate: (templateInput) => {
    const now = Date.now();
    const template: PromptTemplate = normalizeUserTemplate({
      id: templateInput.id ?? generateId("prompt-template"),
      title: templateInput.title,
      description: templateInput.description ?? "",
      category: templateInput.category,
      systemPrompt: templateInput.systemPrompt,
      userPrompt: templateInput.userPrompt,
      surfaces: templateInput.surfaces,
      outputMode: templateInput.outputMode,
      requiredContext: templateInput.requiredContext ?? [],
      optionalContext: templateInput.optionalContext ?? [],
      preferredProvider: templateInput.preferredProvider ?? null,
      preferredModel: templateInput.preferredModel ?? null,
      pinned: Boolean(templateInput.pinned),
      builtin: false,
      version: typeof templateInput.version === "number" ? templateInput.version : 1,
      createdAt: templateInput.createdAt ?? now,
      updatedAt: now,
    });

    set((state) => ({
      userTemplates: [
        template,
        ...state.userTemplates.filter((item) => item.id !== template.id),
      ],
    }));
    debouncedSave({
      userTemplates: get().userTemplates,
      runs: get().runs,
      workspacePreferences: get().workspacePreferences,
    });

    return template;
  },

  deleteTemplate: (templateId) => {
    set((state) => ({
      userTemplates: state.userTemplates.filter((template) => template.id !== templateId),
      workspacePreferences: Object.fromEntries(
        Object.entries(state.workspacePreferences).map(([key, preference]) => [
          key,
          {
            ...preference,
            recentTemplateIds: preference.recentTemplateIds.filter((id) => id !== templateId),
            defaultTemplatesBySurface: Object.fromEntries(
              Object.entries(preference.defaultTemplatesBySurface).filter(([, id]) => id !== templateId),
            ) as PromptWorkspacePreference["defaultTemplatesBySurface"],
          },
        ]),
      ),
    }));
    debouncedSave({
      userTemplates: get().userTemplates,
      runs: get().runs,
      workspacePreferences: get().workspacePreferences,
    });
  },

  addRun: (run) => {
    const id = generateId("prompt-run");
    set((state) => ({
      runs: [
        {
          ...run,
          id,
          createdAt: Date.now(),
        },
        ...state.runs,
      ].slice(0, MAX_PROMPT_RUNS),
    }));
    debouncedSave({
      userTemplates: get().userTemplates,
      runs: get().runs,
      workspacePreferences: get().workspacePreferences,
    });
    return id;
  },

  updateRunResult: (runId, result) => {
    set((state) => ({
      runs: state.runs.map((run) => (run.id === runId ? { ...run, ...result } : run)),
    }));
    debouncedSave({
      userTemplates: get().userTemplates,
      runs: get().runs,
      workspacePreferences: get().workspacePreferences,
    });
  },

  rememberTemplateUsage: (templateId, surface, workspaceIdentity) => {
    const preferenceKey = getWorkspacePreferenceKey(workspaceIdentity);
    set((state) => {
      const currentPreference = getWorkspacePreferenceCandidates(workspaceIdentity)
        .map((candidate) => state.workspacePreferences[candidate])
        .find(Boolean) ?? DEFAULT_PREFERENCE;
      return {
        workspacePreferences: {
          ...state.workspacePreferences,
          [preferenceKey]: {
            recentTemplateIds: [
              templateId,
              ...currentPreference.recentTemplateIds.filter((id) => id !== templateId),
            ].slice(0, MAX_RECENT_TEMPLATE_IDS),
            defaultTemplatesBySurface: {
              ...currentPreference.defaultTemplatesBySurface,
              [surface]: templateId,
            },
          },
        },
      };
    });
    debouncedSave({
      userTemplates: get().userTemplates,
      runs: get().runs,
      workspacePreferences: get().workspacePreferences,
    });
  },

  getTemplatesForSurface: (surface) => {
    const templates = [...BUILTIN_PROMPT_TEMPLATES, ...get().userTemplates]
      .filter((template) => template.surfaces.includes(surface))
      .sort((left, right) => {
        const leftPinned = left.pinned ? 1 : 0;
        const rightPinned = right.pinned ? 1 : 0;
        if (leftPinned !== rightPinned) {
          return rightPinned - leftPinned;
        }
        return left.title.localeCompare(right.title);
      });

    return templates;
  },

  getTemplateById: (templateId) =>
    [...BUILTIN_PROMPT_TEMPLATES, ...get().userTemplates].find((template) => template.id === templateId) ?? null,

  getRecentTemplates: (surface, workspaceIdentity) => {
    const templates = get().getTemplatesForSurface(surface);
    const preference = getWorkspacePreferenceCandidates(workspaceIdentity)
      .map((candidate) => get().workspacePreferences[candidate])
      .find(Boolean) ?? DEFAULT_PREFERENCE;
    return preference.recentTemplateIds
      .map((templateId) => templates.find((template) => template.id === templateId))
      .filter((template): template is PromptTemplate => Boolean(template));
  },

  getRecentRuns: (surface) =>
    get().runs.filter((run) => (surface ? run.surface === surface : true)),
}));
