import type { PluginModule, PluginContext } from '@/lib/plugins/types';

const TEMPLATES: Record<string, { name: string; content: string }> = {
  'research-paper': {
    name: 'Research Paper',
    content: `# Title

## Abstract

Brief summary of the research.

## 1. Introduction

Background and motivation.

## 2. Methods

### 2.1 Experimental Setup

### 2.2 Data Collection

## 3. Results

## 4. Discussion

## 5. Conclusion

## References

`,
  },
  'lab-notebook': {
    name: 'Lab Notebook Entry',
    content: `# Experiment: [Title]

**Date:** ${new Date().toISOString().split('T')[0]}
**Researcher:** [Name]

## Objective

## Materials & Equipment

-

## Procedure

1.

## Observations

## Data

| Parameter | Value | Unit |
|-----------|-------|------|
|           |       |      |

## Analysis

## Conclusions

## Next Steps

`,
  },
  'literature-review': {
    name: 'Literature Review',
    content: `# Literature Review: [Topic]

## Overview

## Key Themes

### Theme 1

### Theme 2

### Theme 3

## Summary Table

| Author(s) | Year | Key Finding | Methodology |
|-----------|------|-------------|-------------|
|           |      |             |             |

## Gaps in Literature

## Research Questions

## References

`,
  },
  'meeting-notes': {
    name: 'Meeting Notes',
    content: `# Meeting Notes

**Date:** ${new Date().toISOString().split('T')[0]}
**Attendees:**

## Agenda

1.

## Discussion

## Action Items

- [ ]

## Next Meeting

`,
  },
};

export const templateLibraryPlugin: PluginModule = {
  manifest: {
    id: 'core.template-library',
    name: 'Template Library',
    version: '1.0.0',
    description: 'Provides document templates for research papers, lab notebooks, literature reviews, and more.',
    author: 'Lattice',
    permissions: ['file:write', 'ui:commands', 'ui:panels'],
    ui: {
      panels: [
        {
          id: 'core.template-library.browser',
          title: 'Templates',
          icon: 'file-text',
          schema: {
            type: 'list',
            title: 'Document Templates',
            description: 'Create new documents from templates',
          },
        },
      ],
    },
  },

  activate(ctx: PluginContext) {
    // Register a command for each template
    for (const [key, template] of Object.entries(TEMPLATES)) {
      ctx.commands.register({
        id: `core.template-library.create-${key}`,
        title: `New from Template: ${template.name}`,
        run: async () => {
          const fileName = `${template.name.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.md`;
          try {
            await ctx.workspace.writeFile(fileName, template.content);
            ctx.log(`Created ${fileName} from template "${template.name}"`);
          } catch (err) {
            ctx.log(`Failed to create file: ${err}`);
          }
        },
      });
    }

    ctx.commands.register({
      id: 'core.template-library.list',
      title: 'List Available Templates',
      run: () => {
        const names = Object.values(TEMPLATES).map((t) => t.name);
        ctx.log(`Available templates: ${names.join(', ')}`);
      },
    });
  },
};
