import { describe, expect, it } from 'vitest';
import { buildCitationContracts } from '../ai/citation-contract';
import { buildCitationPromptReferences, TARGETED_CITATION_INSTRUCTIONS } from '../ai/citation-prompt';
import type { EvidenceRef } from '../ai/types';

describe('targeted citation prompt references', () => {
  it('asks for a distinctive original passage rather than an ambiguous number or unit', () => {
    expect(TARGETED_CITATION_INSTRUCTIONS).toContain('unique within that supplied page or file');
    expect(TARGETED_CITATION_INSTRUCTIONS).toContain('Do not use only a number, unit, or generic phrase');
  });
  it('requires a quote for each whole-file or whole-page context source', () => {
    const refs: EvidenceRef[] = [
      { kind: 'pdf_page', label: 'Field measurement', locator: 'papers/experiment.pdf#page=12', anchor: { page: 12 }, preview: 'The magnetic field is 58 G.' },
      { kind: 'file', label: 'Lab note', locator: 'notes/measurement.md', preview: 'The measured field was confirmed independently.' },
    ];
    const prompt = buildCitationPromptReferences(refs);
    for (const ref of buildCitationContracts(refs)) {
      expect(prompt).toContain(`citation:${ref.stableId}?quote=URL_ENCODED_EXACT_QUOTE`);
      expect(prompt).not.toContain(`(citation:${ref.stableId})`);
    }
    expect(prompt.match(/quote required/g)).toHaveLength(2);
  });

  it('preserves already anchored evidence without making its whole page citable', () => {
    const refs: EvidenceRef[] = [
      { kind: 'pdf_page', label: 'Field measurement', locator: 'papers/experiment.pdf#page=12', anchor: { page: 12, snippet: 'The magnetic field is 58 G.' } },
      { kind: 'pdf_page', label: 'Figure selection', locator: 'papers/experiment.pdf#page=3', anchor: { page: 3, rects: [{ left: 0.1, top: 0.2, width: 0.2, height: 0.1 }] } },
    ];
    const prompt = buildCitationPromptReferences(refs);
    for (const ref of buildCitationContracts(refs)) {
      expect(prompt).toContain(`(citation:${ref.stableId})`);
    }
    expect(prompt).not.toContain('URL_ENCODED_EXACT_QUOTE');
    expect(prompt.match(/passage anchor available/g)).toHaveLength(2);
    expect(prompt).toContain('Anchored passage: "The magnetic field is 58 G."');
  });
});
