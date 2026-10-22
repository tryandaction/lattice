import type { NoteTakingSkillConfig, ResearchAgentWorkflowPreset } from './research-agent-workflows';

/** User-visible deliverables, separate from internal tool/planning instructions. */
export function buildWorkflowAnswerInstructions(
  workflow: ResearchAgentWorkflowPreset | null,
  config: NoteTakingSkillConfig,
  systemPrompt = '',
  options: { markdownDocument?: boolean } = {},
): string {
  const common = [
    systemPrompt,
    config.language === 'en-US' ? 'Write the answer in English.' : '使用简体中文回答，保留必要的原文引文。',
    'Produce a useful result for the user request. Do not repeat the input prompt, context inventory, workflow internals, or empty template scaffolding.',
    'Do not claim that annotations, files, code execution, or experiments have been completed unless an actual successful tool result confirms it. Distinguish proposed work from executed work.',
  ];
  if (workflow?.id === 'pdf-annotation') {
    return [...common,
      `Select only useful passages for the requested PDF annotations (at most ${config.annotationLimit ?? 5}). Each must directly support an important claim, method, result, or limitation across the supplied document coverage; do not fill the quota or highlight every page or whole paragraphs by default.`,
      options.markdownDocument
        ? 'The user also requests a document: first write the complete Markdown explanation at the requested depth, with grounded mechanisms, results and limitations. This narrative is an independent deliverable and must remain useful even if no annotation is possible. Do not replace it with a brief annotation summary. Then append one fenced lattice-annotations JSON block.'
        : 'Give a brief explanation, then one fenced lattice-annotations JSON block.',
      'Select verified evidence by one id: {"annotations":[{"passageId":"EXACT_SUPPLIED_VERIFIED_PASSAGE_ID","reason":"specific reason this passage matters"}]}. The application resolves the exact original quote, source and page; do not retype mathematical passages. The optional legacy sourceId must equal passageId when both are supplied.',
      'Use passageId only for supplied verified anchored passages, never for an unanchored page. If the context explicitly lacks passage ids, the legacy sourceId, page, quote and reason form is supported: copy an 8-600 character unique verbatim quote. Never invent ids, coordinates or missing evidence; a summary is not an original quote.',
      'These are proposals awaiting the user\'s review, not saved highlights. If no suitable supplied original text exists, return an empty annotations array and explain what evidence is missing.',
    ].filter(Boolean).join('\n\n');
  }
  const format = (() => {
    switch (workflow?.id) {
      case 'reading-note': case 'paper-reading': case 'markdown-research':
        return 'Write the actual research note or requested analysis from the evidence, including concrete findings and meaningful limitations. The answer should be directly useful as a saved note.';
      case 'literature-matrix':
        return 'Produce a substantive comparison table across the supplied sources, with comparable methods, findings, limitations, and precise supporting citations. Mark missing information instead of filling it with guesses.';
      case 'notebook-analysis':
        return 'Analyze the supplied notebook code and existing outputs. Separate observed outputs from predicted results; propose concrete cells or corrections when useful, without pretending unexecuted code ran.';
      case 'notebook-from-paper':
        return 'Provide a concrete notebook implementation plan with reproducible cell code, required data, assumptions, and checks. Clearly state that a notebook plan is not a created or executed notebook.';
      case 'code-change-plan':
        return 'Provide a specific change plan or proposed patch grounded in the supplied files, including validation steps. Clearly distinguish proposals from applied edits and tests actually run.';
      case 'knowledge-organization':
        return 'Provide a specific organization proposal based on actual supplied files and their contents. Explain each proposed move or relationship. Do not claim files were moved or rewritten.';
      default:
        return 'Answer the question directly with a useful explanation, examples where supported, and precise citations for substantive source-based claims.';
    }
  })();
  return [...common, format,
    `Writing style: ${config.noteStyle}. Quotation policy: ${config.quotePolicy}.`,
    `Requested sections: ${config.sections.join(', ')}. Fill only supported content; explain important missing evidence instead of adding empty sections or "Review and refine" placeholders.`,
    config.template ? `Use this user-configured template as a structure guide where relevant. Fill placeholders with supported content; never leave literal placeholders in the final output:\n${config.template}` : '',
  ].filter(Boolean).join('\n\n');
}
