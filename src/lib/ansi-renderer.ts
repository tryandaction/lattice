/**
 * ANSI Color Renderer Utility
 * 
 * Converts ANSI escape sequences to styled HTML spans.
 * Supports standard colors, bold, underline, and reset codes.
 */

/**
 * ANSI color codes mapping to CSS colors
 */
const ANSI_COLORS: Record<number, string> = {
  // Standard colors (foreground)
  30: "#000000", // Black
  31: "#cc0000", // Red
  32: "#00cc00", // Green
  33: "#cccc00", // Yellow
  34: "#0000cc", // Blue
  35: "#cc00cc", // Magenta
  36: "#00cccc", // Cyan
  37: "#cccccc", // White
  
  // Bright colors (foreground)
  90: "#666666", // Bright Black (Gray)
  91: "#ff0000", // Bright Red
  92: "#00ff00", // Bright Green
  93: "#ffff00", // Bright Yellow
  94: "#0000ff", // Bright Blue
  95: "#ff00ff", // Bright Magenta
  96: "#00ffff", // Bright Cyan
  97: "#ffffff", // Bright White
};

/**
 * ANSI background color codes mapping to CSS colors
 */
const ANSI_BG_COLORS: Record<number, string> = {
  // Standard background colors
  40: "#000000", // Black
  41: "#cc0000", // Red
  42: "#00cc00", // Green
  43: "#cccc00", // Yellow
  44: "#0000cc", // Blue
  45: "#cc00cc", // Magenta
  46: "#00cccc", // Cyan
  47: "#cccccc", // White
  
  // Bright background colors
  100: "#666666", // Bright Black (Gray)
  101: "#ff0000", // Bright Red
  102: "#00ff00", // Bright Green
  103: "#ffff00", // Bright Yellow
  104: "#0000ff", // Bright Blue
  105: "#ff00ff", // Bright Magenta
  106: "#00ffff", // Bright Cyan
  107: "#ffffff", // Bright White
};

/**
 * Style state for ANSI parsing
 */
interface AnsiStyle {
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}

/**
 * Parsed segment with text and style
 */
interface AnsiSegment {
  text: string;
  style: AnsiStyle;
}

/**
 * Parse ANSI codes and update style state
 */
function parseAnsiCodes(codes: number[], currentStyle: AnsiStyle): AnsiStyle {
  const newStyle = { ...currentStyle };
  
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    
    switch (code) {
      case 0: // Reset
        return {};
      case 1: // Bold
        newStyle.bold = true;
        break;
      case 3: // Italic
        newStyle.italic = true;
        break;
      case 4: // Underline
        newStyle.underline = true;
        break;
      case 9: // Strikethrough
        newStyle.strikethrough = true;
        break;
      case 22: // Normal intensity (not bold)
        newStyle.bold = false;
        break;
      case 23: // Not italic
        newStyle.italic = false;
        break;
      case 24: // Not underlined
        newStyle.underline = false;
        break;
      case 29: // Not strikethrough
        newStyle.strikethrough = false;
        break;
      case 39: // Default foreground color
        delete newStyle.color;
        break;
      case 49: // Default background color
        delete newStyle.backgroundColor;
        break;
      default:
        // Foreground colors
        if (ANSI_COLORS[code]) {
          newStyle.color = ANSI_COLORS[code];
        }
        // Background colors
        else if (ANSI_BG_COLORS[code]) {
          newStyle.backgroundColor = ANSI_BG_COLORS[code];
        }
        // 256-color mode: 38;5;n or 48;5;n
        else if (code === 38 && codes[i + 1] === 5) {
          const colorIndex = codes[i + 2];
          if (colorIndex !== undefined) {
            newStyle.color = get256Color(colorIndex);
            i += 2;
          }
        }
        else if (code === 48 && codes[i + 1] === 5) {
          const colorIndex = codes[i + 2];
          if (colorIndex !== undefined) {
            newStyle.backgroundColor = get256Color(colorIndex);
            i += 2;
          }
        }
        break;
    }
  }
  
  return newStyle;
}

/**
 * Get color from 256-color palette
 */
function get256Color(index: number): string {
  // Standard colors (0-15)
  if (index < 16) {
    const standardColors = [
      "#000000", "#cc0000", "#00cc00", "#cccc00",
      "#0000cc", "#cc00cc", "#00cccc", "#cccccc",
      "#666666", "#ff0000", "#00ff00", "#ffff00",
      "#0000ff", "#ff00ff", "#00ffff", "#ffffff",
    ];
    return standardColors[index] || "#ffffff";
  }
  
  // 216-color cube (16-231)
  if (index < 232) {
    const i = index - 16;
    const r = Math.floor(i / 36);
    const g = Math.floor((i % 36) / 6);
    const b = i % 6;
    const toHex = (v: number) => (v === 0 ? 0 : 55 + v * 40).toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }
  
  // Grayscale (232-255)
  const gray = 8 + (index - 232) * 10;
  const hex = gray.toString(16).padStart(2, "0");
  return `#${hex}${hex}${hex}`;
}

/**
 * Convert style object to inline CSS string
 */
function styleToCSS(style: AnsiStyle): string {
  const parts: string[] = [];
  
  if (style.color) {
    parts.push(`color: ${style.color}`);
  }
  if (style.backgroundColor) {
    parts.push(`background-color: ${style.backgroundColor}`);
  }
  if (style.bold) {
    parts.push("font-weight: bold");
  }
  if (style.italic) {
    parts.push("font-style: italic");
  }
  if (style.underline) {
    parts.push("text-decoration: underline");
  }
  if (style.strikethrough) {
    parts.push("text-decoration: line-through");
  }
  
  return parts.join("; ");
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Parse ANSI text into segments
 */
function parseAnsiText(text: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  let currentStyle: AnsiStyle = {};
  
  // ANSI escape sequence pattern: ESC[...m
  // ESC can be \x1b, \033, or \e
  const ansiPattern = /\x1b\[([0-9;]*)m/g;
  
  let lastIndex = 0;
  let match;
  
  while ((match = ansiPattern.exec(text)) !== null) {
    // Add text before this escape sequence
    if (match.index > lastIndex) {
      const textBefore = text.slice(lastIndex, match.index);
      if (textBefore) {
        segments.push({ text: textBefore, style: { ...currentStyle } });
      }
    }
    
    // Parse the codes
    const codesStr = match[1];
    const codes = codesStr ? codesStr.split(";").map(Number) : [0];
    currentStyle = parseAnsiCodes(codes, currentStyle);
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), style: { ...currentStyle } });
  }
  
  return segments;
}

/**
 * Converts ANSI escape sequences to styled HTML spans.
 */
export function renderAnsiToHtml(text: string): string {
  if (!text) return "";
  
  const segments = parseAnsiText(text);
  
  return segments
    .map((segment) => {
      const escapedText = escapeHtml(segment.text);
      const css = styleToCSS(segment.style);
      
      if (css) {
        return `<span style="${css}">${escapedText}</span>`;
      }
      return escapedText;
    })
    .join("");
}

/**
 * Check if text contains ANSI escape sequences
 */
export function containsAnsiCodes(text: string): boolean {
  return /\x1b\[[0-9;]*m/.test(text);
}

// Export for testing
export { parseAnsiText, parseAnsiCodes, get256Color };
