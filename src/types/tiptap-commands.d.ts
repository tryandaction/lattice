import "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    bulletList: {
      toggleBulletList: () => ReturnType;
    };
    orderedList: {
      toggleOrderedList: () => ReturnType;
    };
    codeBlock: {
      toggleCodeBlock: () => ReturnType;
    };
    blockquote: {
      toggleBlockquote: () => ReturnType;
    };
    table: {
      insertTable: (options?: {
        rows?: number;
        cols?: number;
        withHeaderRow?: boolean;
      }) => ReturnType;
    };
  }
}
