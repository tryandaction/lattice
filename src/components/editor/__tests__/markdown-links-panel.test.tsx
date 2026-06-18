/**
 * @vitest-environment jsdom
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownLinksPanel } from "../markdown-links-panel";
import {
  clearWorkspaceMarkdownLinkIndex,
  upsertWorkspaceMarkdownFile,
} from "@/lib/markdown/workspace-link-index";

vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

async function flushPanelEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("MarkdownLinksPanel", () => {
  afterEach(async () => {
    await act(async () => {
      clearWorkspaceMarkdownLinkIndex();
    });
    localStorage.clear();
  });

  it("renders backlinks, outgoing links and broken links with navigation callbacks", async () => {
    act(() => {
      upsertWorkspaceMarkdownFile(
        "index.md",
        [
          "# Index",
          "See [[Target|target note]] and [Missing](missing.md).",
        ].join("\n"),
      );
    upsertWorkspaceMarkdownFile("Target.md", "# Target");
    upsertWorkspaceMarkdownFile("daily.md", "Target came up in standup.");
    });

    const onNavigate = vi.fn();
    const onNavigateToSource = vi.fn();
    const onCreateMissingNote = vi.fn();
    const onLinkUnlinkedMention = vi.fn();
    const onLinkUnlinkedMentions = vi.fn();
    const onIgnoreUnlinkedMention = vi.fn();
    const onRepairBrokenLink = vi.fn();
    const onConvertMarkdownLinkToWiki = vi.fn();
    const onReviewUnreferencedAttachment = vi.fn();

    let rendered: ReturnType<typeof render>;
    act(() => {
      rendered = render(
        <MarkdownLinksPanel
          filePath="index.md"
          onNavigate={onNavigate}
          onNavigateToSource={onNavigateToSource}
          onCreateMissingNote={onCreateMissingNote}
          onLinkUnlinkedMention={onLinkUnlinkedMention}
          onLinkUnlinkedMentions={onLinkUnlinkedMentions}
          onIgnoreUnlinkedMention={onIgnoreUnlinkedMention}
          onRepairBrokenLink={onRepairBrokenLink}
          onConvertMarkdownLinkToWiki={onConvertMarkdownLinkToWiki}
          attachmentCleanupCandidates={[{
            path: "assets/orphan.png",
            displayPath: "vault/assets/orphan.png",
            extension: "png",
            referenced: false,
          }]}
          onReviewUnreferencedAttachment={onReviewUnreferencedAttachment}
        />,
      );
    });
    const { rerender, container } = rendered!;
    await flushPanelEffects();

    expect(screen.getByText("markdown.links.outgoing")).toBeTruthy();
    expect(screen.getByText("markdown.links.unlinkedMentions")).toBeTruthy();
    expect(screen.getByText("markdown.links.broken")).toBeTruthy();
    expect(screen.getByText("markdown.links.attachments")).toBeTruthy();
    expect(screen.getByText("markdown.links.localGraph")).toBeTruthy();
    expect(screen.getByRole("img", { name: "markdown.links.localGraph.preview" })).toBeTruthy();
    expect(screen.getByText("target note")).toBeTruthy();
    expect(screen.getAllByText("Missing")).toHaveLength(2);
    expect(screen.getAllByText("Target").length).toBeGreaterThan(0);

    act(() => {
      fireEvent.click(screen.getByText("target note"));
    });
    expect(onNavigate).toHaveBeenCalledWith("Target");

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "markdown.links.localGraph.preview: Target.md" }));
    });
    expect(onNavigate).toHaveBeenCalledWith("Target.md");

    act(() => {
      fireEvent.click(screen.getByText("markdown.links.createNote"));
    });
    expect(onCreateMissingNote).toHaveBeenCalledWith(
      expect.objectContaining({
        rawTarget: "missing.md",
        broken: true,
      }),
    );

    act(() => {
      fireEvent.click(screen.getByText("markdown.links.convertToWiki"));
    });
    expect(onConvertMarkdownLinkToWiki).toHaveBeenCalledWith(
      expect.objectContaining({
        rawTarget: "missing.md",
        broken: true,
      }),
    );

    act(() => {
      fireEvent.change(screen.getByLabelText("markdown.links.repairTarget"), {
        target: { value: "Target.md" },
      });
    });
    act(() => {
      fireEvent.click(screen.getByText("markdown.links.repairLink"));
    });
    expect(onRepairBrokenLink).toHaveBeenCalledWith(
      expect.objectContaining({
        rawTarget: "missing.md",
        broken: true,
      }),
      "Target.md",
    );

    act(() => {
      fireEvent.click(screen.getByText("markdown.links.reviewAttachment"));
    });
    expect(onReviewUnreferencedAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "assets/orphan.png",
      }),
    );

    act(() => {
      rerender(
        <MarkdownLinksPanel
          filePath="Target.md"
          onNavigate={onNavigate}
          onNavigateToSource={onNavigateToSource}
          onCreateMissingNote={onCreateMissingNote}
          onLinkUnlinkedMention={onLinkUnlinkedMention}
          onLinkUnlinkedMentions={onLinkUnlinkedMentions}
          onIgnoreUnlinkedMention={onIgnoreUnlinkedMention}
          onRepairBrokenLink={onRepairBrokenLink}
          onConvertMarkdownLinkToWiki={onConvertMarkdownLinkToWiki}
        />,
      );
    });
    await flushPanelEffects();

    const backlinkButton = container.querySelector('button[title="index.md:2"]') as HTMLButtonElement;
    expect(backlinkButton).toBeTruthy();
    act(() => {
      fireEvent.click(backlinkButton);
    });
    expect(onNavigateToSource).toHaveBeenCalledWith("index.md", 2);

    const unlinkedMentionButton = container.querySelector('button[title="daily.md:1"]') as HTMLButtonElement;
    expect(unlinkedMentionButton).toBeTruthy();
    act(() => {
      fireEvent.click(unlinkedMentionButton);
    });
    expect(onNavigateToSource).toHaveBeenCalledWith("daily.md", 1);

    act(() => {
      fireEvent.click(screen.getByText("markdown.links.linkMention"));
    });
    expect(onLinkUnlinkedMention).toHaveBeenCalledWith(
      expect.objectContaining({
        targetFile: "Target.md",
        sourceFile: "daily.md",
        sourceLine: 1,
        mention: "Target",
      }),
    );

    act(() => {
      fireEvent.click(screen.getByText("markdown.links.ignoreMention"));
    });
    expect(onIgnoreUnlinkedMention).toHaveBeenCalledWith(
      expect.objectContaining({
        targetFile: "Target.md",
        sourceFile: "daily.md",
      }),
    );
  });

  it("links all visible unlinked mentions", async () => {
    act(() => {
      upsertWorkspaceMarkdownFile("Target.md", "# Target");
      upsertWorkspaceMarkdownFile("daily.md", "Target came up.");
      upsertWorkspaceMarkdownFile("weekly.md", "Target is still relevant.");
    });

    const onLinkUnlinkedMentions = vi.fn();
    act(() => {
      render(
        <MarkdownLinksPanel
          filePath="Target.md"
          onNavigate={vi.fn()}
          onNavigateToSource={vi.fn()}
          onLinkUnlinkedMentions={onLinkUnlinkedMentions}
        />,
      );
    });
    await flushPanelEffects();

    act(() => {
      fireEvent.click(screen.getByText("markdown.links.linkAllVisible"));
    });
    expect(onLinkUnlinkedMentions).toHaveBeenCalledWith([
      expect.objectContaining({ sourceFile: "daily.md" }),
      expect.objectContaining({ sourceFile: "weekly.md" }),
    ]);
  });

  it("filters visible link rows and remembers collapsed sections", async () => {
    act(() => {
      upsertWorkspaceMarkdownFile("index.md", "See [[Target]] and [[Other]].");
      upsertWorkspaceMarkdownFile("Target.md", "# Target");
      upsertWorkspaceMarkdownFile("Other.md", "# Other");
    });

    let unmount: () => void = () => undefined;
    act(() => {
      ({ unmount } = render(
        <MarkdownLinksPanel
          filePath="index.md"
          onNavigate={vi.fn()}
          onNavigateToSource={vi.fn()}
        />,
      ));
    });
    await flushPanelEffects();

    act(() => {
      fireEvent.change(screen.getByPlaceholderText("markdown.links.filter"), {
        target: { value: "Other" },
      });
    });
    expect(screen.queryByText("Target")).toBeNull();
    expect(screen.getAllByText("Other").length).toBeGreaterThan(0);

    act(() => {
      fireEvent.click(screen.getByText("markdown.links.outgoing"));
    });
    expect(screen.getByText("markdown.links.outgoing").closest("button")?.getAttribute("aria-expanded")).toBe("false");
    unmount();

    act(() => {
      render(
        <MarkdownLinksPanel
          filePath="index.md"
          onNavigate={vi.fn()}
          onNavigateToSource={vi.fn()}
        />,
      );
    });
    await flushPanelEffects();
    expect(screen.getByText("markdown.links.outgoing").closest("button")?.getAttribute("aria-expanded")).toBe("false");
  });
});
