/**
 * @vitest-environment jsdom
 */

import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingWizard } from "../onboarding-wizard";

const settingsState = {
  isInitialized: false,
  settings: {
    onboardingCompleted: false,
  },
  completeOnboarding: vi.fn(async () => {
    settingsState.settings.onboardingCompleted = true;
  }),
};

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

vi.mock("@/components/settings/language-selector", () => ({
  LanguageSelector: () => <div>language-selector</div>,
}));

vi.mock("@/components/settings/theme-selector", () => ({
  ThemeSelector: () => <div>theme-selector</div>,
}));

vi.mock("@/components/settings/folder-selector", () => ({
  FolderSelector: () => <div>folder-selector</div>,
}));

describe("OnboardingWizard visibility", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    settingsState.isInitialized = false;
    settingsState.settings.onboardingCompleted = false;
    settingsState.completeOnboarding.mockClear();
  });

  it("stays hidden before settings are initialized and hides after onboarding completes", async () => {
    const { rerender } = render(<OnboardingWizard />);

    expect(screen.queryByText("onboarding.welcome")).toBeNull();

    settingsState.isInitialized = true;
    rerender(<OnboardingWizard />);

    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    expect(screen.getByText("onboarding.welcome")).not.toBeNull();

    await act(async () => {
      await settingsState.completeOnboarding();
    });
    rerender(<OnboardingWizard />);

    expect(screen.queryByText("onboarding.welcome")).toBeNull();
    vi.useRealTimers();
  });
});
