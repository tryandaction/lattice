/**
 * Enhanced Image Extension for Tiptap
 * 
 * Extends the default image node with:
 * - Resize handles
 * - Alignment options (left, center, right)
 * - Caption support
 * - Drag & drop support
 */

import { Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey, NodeSelection } from "@tiptap/pm/state";

export interface EnhancedImageOptions {
  /** Allow inline images */
  inline: boolean;
  /** Allowed MIME types */
  allowedMimeTypes: string[];
  /** Maximum width in pixels */
  maxWidth: number;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    enhancedImage: {
      /**
       * Set image attributes
       */
      setImage: (options: {
        src: string;
        alt?: string;
        title?: string;
        width?: number;
        height?: number;
        align?: "left" | "center" | "right";
      }) => ReturnType;
      /**
       * Set image alignment
       */
      setImageAlign: (align: "left" | "center" | "right") => ReturnType;
      /**
       * Set image size
       */
      setImageSize: (width: number, height?: number) => ReturnType;
    };
  }
}

export const EnhancedImage = Node.create<EnhancedImageOptions>({
  name: "image",
  
  addOptions() {
    return {
      inline: true,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"],
      maxWidth: 800,
    };
  },

  inline() {
    return this.options.inline;
  },

  group() {
    return this.options.inline ? "inline" : "block";
  },

  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
      alt: {
        default: null,
      },
      title: {
        default: null,
      },
      width: {
        default: null,
        parseHTML: (element) => {
          const width = element.getAttribute("width");
          return width ? parseInt(width, 10) : null;
        },
        renderHTML: (attributes) => {
          if (!attributes.width) {
            return {};
          }
          return { width: attributes.width };
        },
      },
      height: {
        default: null,
        parseHTML: (element) => {
          const height = element.getAttribute("height");
          return height ? parseInt(height, 10) : null;
        },
        renderHTML: (attributes) => {
          if (!attributes.height) {
            return {};
          }
          return { height: attributes.height };
        },
      },
      align: {
        default: "center",
        parseHTML: (element) => {
          return element.getAttribute("data-align") || "center";
        },
        renderHTML: (attributes) => {
          return { "data-align": attributes.align };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "img[src]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const align = HTMLAttributes["data-align"] || "center";
    const wrapperClass = `image-wrapper image-align-${align}`;
    
    return [
      "figure",
      { class: wrapperClass },
      [
        "img",
        mergeAttributes(HTMLAttributes, {
          class: "enhanced-image",
          draggable: "true",
        }),
      ],
    ];
  },

  addCommands() {
    return {
      setImage:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          });
        },
      setImageAlign:
        (align) =>
        ({ commands }) => {
          return commands.updateAttributes(this.name, { align });
        },
      setImageSize:
        (width, height) =>
        ({ commands }) => {
          return commands.updateAttributes(this.name, { width, height });
        },
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;

    return [
      // Drag & drop handler
      new Plugin({
        key: new PluginKey("enhancedImageDrop"),
        props: {
          handleDrop(view, event, slice, moved) {
            // Only handle external drops (not internal moves)
            if (moved) {
              return false;
            }

            const files = event.dataTransfer?.files;
            if (!files || files.length === 0) {
              return false;
            }

            // Check for image files
            const imageFile = Array.from(files).find((file) =>
              options.allowedMimeTypes.includes(file.type)
            );

            if (!imageFile) {
              return false;
            }

            event.preventDefault();

            // Read file as data URL
            const reader = new FileReader();
            reader.onload = () => {
              const src = reader.result as string;
              const { state, dispatch } = view;
              const { tr, schema } = state;

              // Get drop position
              const coordinates = view.posAtCoords({
                left: event.clientX,
                top: event.clientY,
              });

              if (!coordinates) {
                return;
              }

              const imageNode = schema.nodes.image;
              if (imageNode) {
                const node = imageNode.create({
                  src,
                  alt: imageFile.name,
                });
                tr.insert(coordinates.pos, node);
                dispatch(tr);
              }
            };

            reader.readAsDataURL(imageFile);
            return true;
          },
        },
      }),
      // Click handler for selection
      new Plugin({
        key: new PluginKey("enhancedImageClick"),
        props: {
          handleClick(view, pos, event) {
            const target = event.target as HTMLElement;
            
            if (target.tagName === "IMG" && target.classList.contains("enhanced-image")) {
              // Select the image node
              const { state, dispatch } = view;
              const $pos = state.doc.resolve(pos);
              
              // Find the image node
              let imagePos = pos;
              for (let d = $pos.depth; d >= 0; d--) {
                const node = $pos.node(d);
                if (node.type.name === "image") {
                  imagePos = $pos.before(d);
                  break;
                }
              }
              
              // Use NodeSelection for selecting the image
              const tr = state.tr.setSelection(
                NodeSelection.create(state.doc, imagePos)
              );
              dispatch(tr);
              return true;
            }
            
            return false;
          },
        },
      }),
    ];
  },
});

export default EnhancedImage;
