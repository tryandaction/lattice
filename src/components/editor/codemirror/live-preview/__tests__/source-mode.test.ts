import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  codeBlockSourceModeField,
  isCodeBlockSourceMode,
  setCodeBlockSourceMode,
} from '../source-mode';

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [codeBlockSourceModeField],
  });
}

describe('code block source mode field', () => {
  it('sets source mode when selection is inside range', () => {
    let state = createState('aaa\nbbb\nccc');
    state = state.update({
      effects: setCodeBlockSourceMode.of({ from: 0, to: 7 }),
      selection: { anchor: 2 },
    }).state;

    const range = state.field(codeBlockSourceModeField);
    expect(range).toEqual({ from: 0, to: 7 });
    expect(isCodeBlockSourceMode(state, 0, 7)).toBe(true);
  });

  it('clears source mode when selection moves outside range', () => {
    let state = createState('aaa\nbbb\nccc');
    state = state.update({
      effects: setCodeBlockSourceMode.of({ from: 0, to: 7 }),
      selection: { anchor: 2 },
    }).state;

    state = state.update({
      selection: { anchor: state.doc.length },
    }).state;

    expect(state.field(codeBlockSourceModeField)).toBeNull();
  });

  it('maps source mode range through document changes', () => {
    let state = createState('aaa\nbbb\nccc');
    state = state.update({
      effects: setCodeBlockSourceMode.of({ from: 0, to: 7 }),
      selection: { anchor: 2 },
    }).state;

    state = state.update({
      changes: { from: 0, insert: 'xx' },
      selection: { anchor: 4 }, // still inside mapped range
    }).state;

    const mapped = state.field(codeBlockSourceModeField);
    expect(mapped).toEqual({ from: 0, to: 9 });
    expect(isCodeBlockSourceMode(state, 0, 9)).toBe(true);
  });

  it('matches source mode by overlap instead of strict equality', () => {
    let state = createState('aaa\nbbb\nccc');
    state = state.update({
      effects: setCodeBlockSourceMode.of({ from: 2, to: 9 }),
      selection: { anchor: 4 },
    }).state;

    expect(isCodeBlockSourceMode(state, 0, 5)).toBe(true);
    expect(isCodeBlockSourceMode(state, 10, 12)).toBe(false);
  });
});
