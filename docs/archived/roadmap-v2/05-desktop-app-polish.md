# Prompt 05: Desktop App Polish & Adaptation

## Priority: P2 (Medium)

## Overview

The Tauri desktop app needs polish to feel like a **native application**. This includes proper window sizing, fullscreen defaults, layout fixes, and platform-specific optimizations.

---

## Related Files

- `src-tauri/tauri.conf.json` - Tauri configuration
- `src-tauri/src/main.rs` - Rust backend
- `src/app/layout.tsx` - Root layout
- `src/styles/globals.css` - Global styles
- `src-tauri/Cargo.toml` - Rust dependencies

---

## Current Issues

1. **Layout Cut Off**: Default window doesn't show bottom of UI
2. **Not Maximized**: Starts in small window, user must manually maximize
3. **No Window State Persistence**: Doesn't remember size/position
4. **Missing Native Feel**: Doesn't feel like desktop app

---

## Feature 1: Default to Maximized/Fullscreen

### Goal
App should start **maximized** (not fullscreen) by default, showing all UI elements.

### Implementation Details

#### 1.1 Tauri Configuration
```json
// src-tauri/tauri.conf.json
{
  "app": {
    "windows": [
      {
        "title": "Lattice",
        "width": 1280,
        "height": 800,
        "minWidth": 800,
        "minHeight": 600,
        "maximized": true,
        "resizable": true,
        "fullscreen": false,
        "decorations": true,
        "center": true
      }
    ]
  }
}
```

#### 1.2 Programmatic Maximize (Rust)
```rust
// src-tauri/src/main.rs
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Get the main window
            let window = app.get_webview_window("main").unwrap();

            // Maximize on startup
            window.maximize().ok();

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

#### 1.3 Window State Plugin (Persistence)
```rust
// Add to Cargo.toml
[dependencies]
tauri-plugin-window-state = "2"

// In main.rs
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

This plugin automatically saves and restores:
- Window position
- Window size
- Maximized state
- Display (for multi-monitor setups)

### Acceptance Criteria
- [ ] App starts maximized
- [ ] All UI visible without scrolling
- [ ] Minimum window size enforced
- [ ] Window state persisted across launches

---

## Feature 2: Layout Responsive to Window Size

### Goal
UI should adapt to any window size without cutting off content.

### Implementation Details

#### 2.1 Root Layout CSS
```css
/* src/styles/globals.css */

/* Ensure full height usage */
html, body, #__next {
  height: 100%;
  overflow: hidden;
}

/* Main app container */
.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

/* Ensure content area fills available space */
.main-content {
  flex: 1;
  overflow: auto;
  min-height: 0; /* Important for flex children */
}
```

#### 2.2 Layout Component Fix
```typescript
// src/app/layout.tsx
export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full overflow-hidden">
        <div className="app-container h-full flex flex-col">
          {/* Header if any */}
          <main className="flex-1 min-h-0 overflow-hidden">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
```

#### 2.3 Viewport Height Fix
```css
/* Handle mobile browser viewport issues */
:root {
  --vh: 1vh;
}

.app-container {
  height: calc(var(--vh, 1vh) * 100);
}
```

```typescript
// Handle dynamic viewport height
useEffect(() => {
  const setVH = () => {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
  };
  setVH();
  window.addEventListener('resize', setVH);
  return () => window.removeEventListener('resize', setVH);
}, []);
```

### Acceptance Criteria
- [ ] No content cut off at any window size
- [ ] Scroll appears only where needed
- [ ] Resize works smoothly
- [ ] Works on different screen resolutions

---

## Feature 3: Native Titlebar Integration

### Goal
Make the app feel more native with proper titlebar handling.

### Implementation Details

#### 3.1 Custom Titlebar (Optional)
```typescript
// If using custom titlebar for consistent cross-platform look
function CustomTitlebar() {
  const isMaximized = useWindowState('maximized');
  const { minimize, maximize, close } = useWindowControls();

  return (
    <div className="h-8 bg-background border-b flex items-center justify-between px-2 select-none" data-tauri-drag-region>
      {/* Left: App icon and title */}
      <div className="flex items-center gap-2">
        <img src="/icon.png" alt="" className="w-4 h-4" />
        <span className="text-sm font-medium">Lattice</span>
      </div>

      {/* Right: Window controls */}
      <div className="flex items-center">
        <button className="titlebar-button" onClick={minimize}>
          <Minus className="h-4 w-4" />
        </button>
        <button className="titlebar-button" onClick={maximize}>
          {isMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        <button className="titlebar-button hover:bg-red-500" onClick={close}>
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
```

#### 3.2 Tauri Commands for Window Control
```typescript
// src/lib/tauri-window.ts
import { appWindow } from '@tauri-apps/api/window';

export async function minimizeWindow() {
  await appWindow.minimize();
}

export async function maximizeWindow() {
  if (await appWindow.isMaximized()) {
    await appWindow.unmaximize();
  } else {
    await appWindow.maximize();
  }
}

export async function closeWindow() {
  await appWindow.close();
}

export function useWindowState() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const checkState = async () => {
      setIsMaximized(await appWindow.isMaximized());
    };
    checkState();

    // Listen for state changes
    const unlisten = appWindow.onResized(() => checkState());
    return () => { unlisten.then(fn => fn()); };
  }, []);

  return isMaximized;
}
```

### Acceptance Criteria
- [ ] Titlebar looks native
- [ ] Window controls work
- [ ] Double-click titlebar toggles maximize
- [ ] Drag titlebar moves window

---

## Feature 4: Desktop-Specific Features

### Goal
Add features that make sense for desktop usage.

### Implementation Details

#### 4.1 Native File Dialogs
```typescript
// Use Tauri's native file picker instead of browser
import { open } from '@tauri-apps/plugin-dialog';

async function openFile() {
  const selected = await open({
    multiple: false,
    filters: [{
      name: 'Documents',
      extensions: ['pdf', 'md', 'ipynb', 'docx', 'pptx']
    }]
  });

  if (selected) {
    // Load the file
    loadFile(selected);
  }
}
```

#### 4.2 Drag and Drop Files
```typescript
// Handle file drops from desktop
import { listen } from '@tauri-apps/api/event';

useEffect(() => {
  const unlisten = listen('tauri://file-drop', (event) => {
    const files = event.payload as string[];
    if (files.length > 0) {
      handleFileDrop(files[0]);
    }
  });

  return () => { unlisten.then(fn => fn()); };
}, []);
```

#### 4.3 Recent Files
```typescript
// Track recently opened files
import { Store } from '@tauri-apps/plugin-store';

const store = new Store('recent-files.json');

export async function addRecentFile(path: string) {
  const recent = await store.get<string[]>('files') || [];
  const updated = [path, ...recent.filter(f => f !== path)].slice(0, 10);
  await store.set('files', updated);
  await store.save();
}

export async function getRecentFiles(): Promise<string[]> {
  return await store.get<string[]>('files') || [];
}
```

### Acceptance Criteria
- [ ] Native file picker works
- [ ] Can drag files onto app
- [ ] Recent files tracked
- [ ] Files open correctly

---

## Feature 5: Performance Optimizations

### Goal
Ensure smooth performance in desktop environment.

### Implementation Details

#### 5.1 Disable Unnecessary Web Features
```json
// tauri.conf.json - security settings
{
  "app": {
    "security": {
      "csp": null
    }
  }
}
```

#### 5.2 Enable Hardware Acceleration
```rust
// main.rs - ensure hardware acceleration
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

#### 5.3 Memory Management
```typescript
// Clean up large files from memory when not in use
useEffect(() => {
  return () => {
    // Release ArrayBuffer when component unmounts
    if (fileContent) {
      // Clear references to allow GC
      setFileContent(null);
    }
  };
}, []);
```

### Acceptance Criteria
- [ ] App launches quickly (<3s)
- [ ] Smooth scrolling in PDF
- [ ] No memory leaks with large files
- [ ] Responsive UI during file operations

---

## Feature 6: Native Keyboard Shortcuts

### Goal
Support system-wide keyboard shortcuts.

### Implementation Details

```typescript
// Register app-wide shortcuts
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';

useEffect(() => {
  const shortcuts = [
    { shortcut: 'CmdOrCtrl+O', handler: openFile },
    { shortcut: 'CmdOrCtrl+S', handler: saveFile },
    { shortcut: 'CmdOrCtrl+N', handler: newFile },
    { shortcut: 'CmdOrCtrl+W', handler: closeTab },
  ];

  shortcuts.forEach(({ shortcut, handler }) => {
    register(shortcut, handler);
  });

  return () => {
    shortcuts.forEach(({ shortcut }) => {
      unregister(shortcut);
    });
  };
}, []);
```

### Acceptance Criteria
- [ ] Ctrl+O opens file
- [ ] Ctrl+S saves file
- [ ] Ctrl+N creates new file
- [ ] Shortcuts work globally in app

---

## Testing

### Manual Checklist

1. **Window Startup**
   - Launch app
   - Verify starts maximized
   - Verify all UI visible

2. **Window State**
   - Resize window
   - Close app
   - Reopen
   - Verify size/position restored

3. **Layout Responsiveness**
   - Resize to various sizes
   - Verify no content cut off
   - Check minimum size enforced

4. **File Operations**
   - Open file via Ctrl+O
   - Drag file onto app
   - Verify both methods work

5. **Performance**
   - Open large PDF
   - Scroll quickly
   - Check for lag

---

## Platform-Specific Notes

### Windows
- Use native title bar decorations
- Support system dark/light mode
- Handle DPI scaling

### macOS
- Use traffic light buttons
- Support full-screen mode
- Handle menu bar

### Linux
- Support various desktop environments
- Handle different window managers
- Test on common distros

---

## Commands Reference

```bash
# Development
npm run tauri dev

# Build
npm run tauri build

# Debug build
npm run tauri build -- --debug
```
