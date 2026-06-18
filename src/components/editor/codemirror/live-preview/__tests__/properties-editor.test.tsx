/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import {
  getRelativeDateString,
  getTodayDateString,
  getWorkspaceMetadataKeySuggestions,
  parsePropertiesSource,
  PropertiesEditor,
  serializePropertiesRows,
  suggestPropertyValueType,
} from "../properties-editor";

function createViewStub(): EditorView {
  return {
    dispatch: vi.fn(),
  } as unknown as EditorView;
}

describe("PropertiesEditor", () => {
  it("parses editable scalar properties and preserves complex YAML rows", () => {
    const rows = parsePropertiesSource(
      '---\nstatus: "draft"\npriority: 1\npublished: true\ndue: 2026-06-17\ntags: [alpha, "beta"]\nnested:\n  - note\nsummary: |\n  Keep this\n---',
    );

    expect(rows).toMatchObject([
      { key: "status", value: "draft", editable: true, valueType: "text" },
      { key: "priority", value: "1", editable: true, valueType: "number" },
      { key: "published", value: "true", editable: true, valueType: "boolean" },
      { key: "due", value: "2026-06-17", editable: true, valueType: "date" },
      { key: "tags", value: "alpha, beta", editable: true, valueType: "list" },
      { raw: "nested:", editable: false, astKind: "complex" },
      { raw: "  - note", editable: false, astKind: "continuation" },
      { raw: "summary: |", editable: false, astKind: "complex" },
      { raw: "  Keep this", editable: false, astKind: "continuation" },
    ]);
  });

  it("serializes simple rows without dropping preserved YAML", () => {
    const rows = parsePropertiesSource(
      "---\nstatus: draft\n\naliases:\n  - one\n---",
    );

    expect(serializePropertiesRows(rows)).toBe(
      '---\nstatus: "draft"\n\naliases:\n  - one\n---',
    );
  });

  it("preserves complex YAML values instead of treating them as editable scalars", () => {
    const rows = parsePropertiesSource(
      "---\nmetadata: { owner: ada }\nstatus: draft # keep comment\nref: &main draft\nalias: *main\ncustom: !secret value\ntags: [alpha, beta]\n---",
    );

    expect(rows).toMatchObject([
      { raw: "metadata: { owner: ada }", editable: false },
      { raw: "status: draft # keep comment", editable: false },
      { raw: "ref: &main draft", editable: false },
      { raw: "alias: *main", editable: false },
      { raw: "custom: !secret value", editable: false },
      { key: "tags", value: "alpha, beta", editable: true, valueType: "list" },
    ]);
    expect(serializePropertiesRows(rows)).toBe(
      '---\nmetadata: { owner: ada }\nstatus: draft # keep comment\nref: &main draft\nalias: *main\ncustom: !secret value\ntags: ["alpha", "beta"]\n---',
    );
  });

  it("suggests property value types from common metadata keys", () => {
    expect(suggestPropertyValueType("tags")).toBe("list");
    expect(suggestPropertyValueType("due")).toBe("date");
    expect(suggestPropertyValueType("published")).toBe("boolean");
    expect(suggestPropertyValueType("priority")).toBe("number");
    expect(suggestPropertyValueType("summary")).toBeNull();
  });

  it("builds workspace metadata key suggestions from known and local rows", () => {
    const rows = parsePropertiesSource("---\nproject: Lattice\ntags: [alpha]\n---");

    expect(getWorkspaceMetadataKeySuggestions(rows)).toEqual(
      expect.arrayContaining([
        { key: "created", valueType: "date" },
        { key: "project", valueType: "text" },
        { key: "tags", valueType: "list" },
      ]),
    );
  });

  it("dispatches a full frontmatter replacement when editing a property value", () => {
    const view = createViewStub();
    const source = '---\nstatus: "draft"\npriority: 1\n---';

    render(
      <PropertiesEditor
        source={source}
        from={0}
        to={source.length}
        view={view}
      />,
    );
    fireEvent.change(screen.getByLabelText("Property value for status"), {
      target: { value: "done" },
    });

    expect(view.dispatch).toHaveBeenCalledWith({
      changes: {
        from: 0,
        to: source.length,
        insert: '---\nstatus: "done"\npriority: 1\n---',
      },
    });
  });

  it("serializes typed property values from visual controls", () => {
    const view = createViewStub();
    const source = "---\npublished: true\ntags: [alpha]\n---";

    render(
      <PropertiesEditor
        source={source}
        from={0}
        to={source.length}
        view={view}
      />,
    );

    fireEvent.click(screen.getByLabelText("Property value for published"));
    expect(view.dispatch).toHaveBeenCalledWith({
      changes: {
        from: 0,
        to: source.length,
        insert: '---\npublished: false\ntags: ["alpha"]\n---',
      },
    });

    fireEvent.change(screen.getByLabelText("Property type for tags"), {
      target: { value: "text" },
    });
    expect(view.dispatch).toHaveBeenLastCalledWith({
      changes: {
        from: 0,
        to: source.length,
        insert: '---\npublished: true\ntags: "alpha"\n---',
      },
    });
  });

  it("sets date properties to today without lossy parsing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 17, 12));
    const view = createViewStub();
    const source = "---\ndue: \n---";

    render(
      <PropertiesEditor
        source={source}
        from={0}
        to={source.length}
        view={view}
      />,
    );
    fireEvent.click(screen.getByLabelText("Set due to today"));

    expect(getTodayDateString()).toBe("2026-06-17");
    expect(view.dispatch).toHaveBeenLastCalledWith({
      changes: {
        from: 0,
        to: source.length,
        insert: "---\ndue: 2026-06-17\n---",
      },
    });
    vi.useRealTimers();
  });

  it("supports date clear and relative presets without display/writeback drift", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 17, 12));
    const view = createViewStub();
    const source = "---\ndue: 2026-06-17\n---";

    render(
      <PropertiesEditor
        source={source}
        from={0}
        to={source.length}
        view={view}
      />,
    );

    fireEvent.click(screen.getByLabelText("Set due to tomorrow"));
    expect(getRelativeDateString(1)).toBe("2026-06-18");
    expect(view.dispatch).toHaveBeenLastCalledWith({
      changes: {
        from: 0,
        to: source.length,
        insert: "---\ndue: 2026-06-18\n---",
      },
    });

    fireEvent.click(screen.getByLabelText("Set due to next week"));
    expect(view.dispatch).toHaveBeenLastCalledWith({
      changes: {
        from: 0,
        to: source.length,
        insert: "---\ndue: 2026-06-24\n---",
      },
    });

    fireEvent.click(screen.getByLabelText("Clear due"));
    expect(view.dispatch).toHaveBeenLastCalledWith({
      changes: {
        from: 0,
        to: source.length,
        insert: "---\ndue: \"\"\n---",
      },
    });
    vi.useRealTimers();
  });

  it("applies metadata type suggestions when renaming empty properties", () => {
    const view = createViewStub();
    const source = '---\nproperty: ""\n---';

    render(
      <PropertiesEditor
        source={source}
        from={0}
        to={source.length}
        view={view}
      />,
    );
    fireEvent.change(screen.getByLabelText("Property key"), {
      target: { value: "tags" },
    });

    expect(view.dispatch).toHaveBeenLastCalledWith({
      changes: {
        from: 0,
        to: source.length,
        insert: "---\ntags: []\n---",
      },
    });
  });

  it("edits list values through chips and keyboard input", () => {
    const view = createViewStub();
    const source = "---\ntags: [alpha, beta]\n---";

    render(
      <PropertiesEditor
        source={source}
        from={0}
        to={source.length}
        view={view}
      />,
    );

    fireEvent.click(screen.getByLabelText("Remove alpha from tags"));
    expect(view.dispatch).toHaveBeenLastCalledWith({
      changes: {
        from: 0,
        to: source.length,
        insert: '---\ntags: ["beta"]\n---',
      },
    });

    const input = screen.getByLabelText("Add list item for tags");
    fireEvent.change(input, { target: { value: "gamma" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(view.dispatch).toHaveBeenLastCalledWith({
      changes: {
        from: 0,
        to: source.length,
        insert: '---\ntags: ["alpha", "beta", "gamma"]\n---',
      },
    });

    fireEvent.keyDown(input, { key: "Backspace" });
    expect(view.dispatch).toHaveBeenLastCalledWith({
      changes: {
        from: 0,
        to: source.length,
        insert: '---\ntags: ["alpha"]\n---',
      },
    });
  });

  it("keeps invalid and duplicate property keys as drafts without rewriting YAML", () => {
    const view = createViewStub();
    const source = "---\nstatus: draft\npriority: 1\n---";

    render(
      <PropertiesEditor
        source={source}
        from={0}
        to={source.length}
        view={view}
      />,
    );

    const keyInputs = screen.getAllByLabelText("Property key");
    fireEvent.change(keyInputs[1], { target: { value: "status" } });

    expect(screen.getAllByText("Duplicate property key")).toHaveLength(2);
    expect(view.dispatch).not.toHaveBeenCalled();

    fireEvent.change(keyInputs[0], { target: { value: "123-invalid" } });

    expect(
      screen.getAllByText(
        "Use letters, numbers, _, ., or -, and start with a letter or _.",
      ),
    ).toHaveLength(1);
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("moves keyboard focus between property values by row", () => {
    const view = createViewStub();
    const source = "---\nstatus: draft\npriority: 1\n---";

    render(
      <PropertiesEditor
        source={source}
        from={0}
        to={source.length}
        view={view}
      />,
    );

    const statusValue = screen.getByLabelText("Property value for status");
    const priorityValue = screen.getByLabelText("Property value for priority");
    statusValue.focus();

    fireEvent.keyDown(statusValue, { key: "ArrowDown" });

    expect(document.activeElement).toBe(priorityValue);
  });

  it("adds and deletes properties while preserving raw YAML rows", () => {
    const view = createViewStub();
    const source = "---\nstatus: draft\naliases:\n  - preserved\n---";
    const { rerender } = render(
      <PropertiesEditor
        source={source}
        from={0}
        to={source.length}
        view={view}
      />,
    );

    fireEvent.click(screen.getByText("Add"));
    expect(view.dispatch).toHaveBeenLastCalledWith({
      changes: {
        from: 0,
        to: source.length,
        insert:
          '---\nstatus: "draft"\naliases:\n  - preserved\nproperty: ""\n---',
      },
    });

    const nextSource =
      '---\nstatus: draft\naliases:\n  - preserved\nproperty: ""\n---';
    rerender(
      <PropertiesEditor
        source={nextSource}
        from={0}
        to={nextSource.length}
        view={view}
      />,
    );
    fireEvent.click(screen.getByLabelText("Delete property property"));

    expect(view.dispatch).toHaveBeenLastCalledWith({
      changes: {
        from: 0,
        to: nextSource.length,
        insert: '---\nstatus: "draft"\naliases:\n  - preserved\n---',
      },
    });
  });

  it("shows preserved YAML AST reasons in the inspector", () => {
    const view = createViewStub();
    const source = "---\nmetadata: { owner: ada }\nsummary: |\n  Keep this\n---";

    render(
      <PropertiesEditor
        source={source}
        from={0}
        to={source.length}
        view={view}
      />,
    );

    fireEvent.click(screen.getByText("Preserved YAML"));

    expect(screen.getByText(/\[raw\] \(inline object\) metadata/)).toBeTruthy();
    expect(screen.getByText(/\[complex\] \(block scalar or nested YAML\) summary/)).toBeTruthy();
  });
});
