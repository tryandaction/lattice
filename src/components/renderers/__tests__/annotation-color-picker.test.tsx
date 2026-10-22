import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { AnnotationColorPicker } from "../annotation-color-picker";

afterEach(() => act(() => setLocale("zh-CN")));

describe("AnnotationColorPicker locale", () => {
  it("switches the open palette labels while preserving color and note actions", () => {
    setLocale("zh-CN");
    const onColorSelect = vi.fn();
    const onTextNoteRequest = vi.fn();
    render(<AnnotationColorPicker position={{ x: 200, y: 200 }} onColorSelect={onColorSelect} onTextNoteRequest={onTextNoteRequest} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "更多颜色..." }));
    expect(screen.getByRole("button", { name: "紫色" })).toBeTruthy();
    act(() => setLocale("en-US"));
    expect(screen.getByRole("toolbar", { name: "Choose color" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Purple" }));
    expect(onColorSelect).toHaveBeenCalledWith("#9C27B0");
    fireEvent.click(screen.getByRole("button", { name: "Add text annotation" }));
    expect(onTextNoteRequest).toHaveBeenCalledTimes(1);
  });
});
