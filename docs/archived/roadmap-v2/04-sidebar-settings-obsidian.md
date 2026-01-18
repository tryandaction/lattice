# Prompt 04: Sidebar & Settings Obsidian-Style Redesign

## Priority: P2 (Medium)

## Overview

Redesign the left sidebar to match the clean, focused aesthetic of Obsidian. Move the settings button to the **bottom-left corner** of the sidebar, creating a familiar and intuitive layout for power users.

---

## Related Files

- `src/components/sidebar/file-browser.tsx` - File browser component
- `src/components/sidebar/sidebar-container.tsx` - Sidebar wrapper
- `src/app/layout.tsx` - App layout
- `src/components/settings/` - Settings components
- `src/stores/settings-store.ts` - Settings state

---

## Current State

- Settings button location may be in header or unclear location
- Sidebar may not have clear visual hierarchy
- No quick-access actions at bottom

## Target State (Obsidian-like)

```
┌─────────────────────────────┐
│ 📁 Files              [+] [≡]│  ← Header with actions
├─────────────────────────────┤
│                             │
│   📄 README.md              │
│   📁 notes/                 │
│      📄 physics.md          │
│      📄 chemistry.md        │
│   📁 papers/                │
│   📄 todo.md                │
│                             │
│                             │
│                             │
│                             │
├─────────────────────────────┤
│ [⚙️ Settings] [?] [👤]      │  ← Bottom action bar
└─────────────────────────────┘
```

---

## Feature 1: Sidebar Structure Redesign

### Goal
Create clear visual zones: header, content, footer.

### Implementation Details

#### 1.1 Sidebar Container
```typescript
// src/components/sidebar/sidebar-container.tsx
export function SidebarContainer({ children }) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div
      className={cn(
        "flex flex-col h-full bg-sidebar border-r border-border transition-all duration-200",
        isCollapsed ? "w-12" : "w-64"
      )}
    >
      {/* Header */}
      <SidebarHeader
        isCollapsed={isCollapsed}
        onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
      />

      {/* Content (scrollable) */}
      <div className="flex-1 overflow-auto">
        {children}
      </div>

      {/* Footer (fixed at bottom) */}
      <SidebarFooter isCollapsed={isCollapsed} />
    </div>
  );
}
```

#### 1.2 Sidebar Header
```typescript
function SidebarHeader({ isCollapsed, onToggleCollapse }) {
  return (
    <div className="flex items-center justify-between p-2 border-b border-border">
      {!isCollapsed && (
        <span className="text-sm font-medium text-muted-foreground">Files</span>
      )}

      <div className="flex items-center gap-0.5">
        {!isCollapsed && (
          <>
            <TooltipButton
              icon={<FilePlus className="h-4 w-4" />}
              tooltip="New file (Ctrl+N)"
              onClick={handleNewFile}
            />
            <TooltipButton
              icon={<FolderPlus className="h-4 w-4" />}
              tooltip="New folder"
              onClick={handleNewFolder}
            />
          </>
        )}
        <TooltipButton
          icon={isCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          tooltip={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={onToggleCollapse}
        />
      </div>
    </div>
  );
}
```

#### 1.3 Sidebar Footer (Settings Location)
```typescript
function SidebarFooter({ isCollapsed }) {
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="border-t border-border p-2">
      <div className="flex items-center justify-between">
        {/* Settings button - PRIMARY action */}
        <TooltipButton
          icon={<Settings className="h-4 w-4" />}
          tooltip="Settings (Ctrl+,)"
          onClick={() => setShowSettings(true)}
          className={cn(
            "flex items-center gap-2",
            !isCollapsed && "flex-1 justify-start px-2 py-1.5 hover:bg-muted rounded-md"
          )}
        >
          {!isCollapsed && <span className="text-sm">Settings</span>}
        </TooltipButton>

        {!isCollapsed && (
          <div className="flex items-center gap-0.5">
            <TooltipButton
              icon={<HelpCircle className="h-4 w-4" />}
              tooltip="Help & Documentation"
              onClick={handleHelp}
            />
          </div>
        )}
      </div>

      {/* Settings Dialog */}
      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} />
    </div>
  );
}
```

### Acceptance Criteria
- [ ] Sidebar has clear header/content/footer zones
- [ ] Settings button is in bottom-left
- [ ] Can collapse sidebar to icon-only mode
- [ ] Tooltips show keyboard shortcuts

---

## Feature 2: Collapsible Sidebar

### Goal
Allow sidebar to collapse to a narrow icon bar, giving more space for content.

### Implementation Details

#### 2.1 Collapsed State
```typescript
// Collapsed sidebar shows only icons
function CollapsedSidebar() {
  return (
    <div className="w-12 h-full flex flex-col items-center py-2 gap-1 border-r">
      {/* File browser icon */}
      <TooltipButton
        icon={<Files className="h-5 w-5" />}
        tooltip="Files"
        tooltipSide="right"
      />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Settings at bottom */}
      <TooltipButton
        icon={<Settings className="h-5 w-5" />}
        tooltip="Settings (Ctrl+,)"
        tooltipSide="right"
      />
    </div>
  );
}
```

#### 2.2 Persist Collapsed State
```typescript
// Remember sidebar state
const SIDEBAR_STATE_KEY = 'lattice:sidebar:collapsed';

function useSidebarState() {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(SIDEBAR_STATE_KEY) === 'true';
  });

  useEffect(() => {
    localStorage.setItem(SIDEBAR_STATE_KEY, String(isCollapsed));
  }, [isCollapsed]);

  return [isCollapsed, setIsCollapsed] as const;
}
```

#### 2.3 Keyboard Shortcut
```typescript
// Ctrl+B to toggle sidebar (like VS Code)
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'b') {
      e.preventDefault();
      setIsCollapsed(prev => !prev);
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);
```

### Acceptance Criteria
- [ ] Sidebar can collapse to 48px wide
- [ ] Collapsed shows icons only
- [ ] Tooltips appear on right side when collapsed
- [ ] Ctrl+B toggles sidebar
- [ ] State persisted across sessions

---

## Feature 3: Settings Dialog Redesign

### Goal
Create a clean, organized settings dialog similar to Obsidian's.

### Implementation Details

#### 3.1 Settings Dialog Structure
```typescript
function SettingsDialog({ open, onOpenChange }) {
  const [activeTab, setActiveTab] = useState('general');

  const tabs = [
    { id: 'general', label: 'General', icon: Settings },
    { id: 'editor', label: 'Editor', icon: Edit3 },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'files', label: 'Files & Links', icon: Files },
    { id: 'keyboard', label: 'Hotkeys', icon: Keyboard },
    { id: 'about', label: 'About', icon: Info },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[600px] p-0 flex">
        {/* Sidebar navigation */}
        <div className="w-48 border-r bg-muted/30 py-4">
          <div className="px-4 pb-4">
            <h2 className="text-lg font-semibold">Settings</h2>
          </div>
          <nav className="space-y-0.5 px-2">
            {tabs.map(tab => (
              <button
                key={tab.id}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors",
                  activeTab === tab.id
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
                onClick={() => setActiveTab(tab.id)}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-auto p-6">
          <SettingsContent tab={activeTab} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

#### 3.2 General Settings Tab
```typescript
function GeneralSettings() {
  const { language, setLanguage, autoSave, setAutoSave } = useSettings();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium mb-4">General</h3>

        <div className="space-y-4">
          <SettingItem
            label="Language"
            description="Interface language"
          >
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="zh">中文</SelectItem>
              </SelectContent>
            </Select>
          </SettingItem>

          <SettingItem
            label="Auto-save"
            description="Automatically save changes"
          >
            <Switch checked={autoSave} onCheckedChange={setAutoSave} />
          </SettingItem>
        </div>
      </div>
    </div>
  );
}
```

#### 3.3 Setting Item Component
```typescript
function SettingItem({ label, description, children }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b">
      <div className="space-y-0.5">
        <label className="text-sm font-medium">{label}</label>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}
```

#### 3.4 Keyboard Shortcut to Open
```typescript
// Ctrl+, to open settings (standard)
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.key === ',') {
      e.preventDefault();
      setShowSettings(true);
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);
```

### Acceptance Criteria
- [ ] Settings opens with Ctrl+,
- [ ] Tabbed navigation on left
- [ ] Clean setting item layout
- [ ] All current settings accessible
- [ ] Settings persist after closing

---

## Feature 4: Appearance Settings

### Goal
Allow users to customize the look and feel.

### Implementation Details

#### 4.1 Theme Selection
```typescript
function AppearanceSettings() {
  const { theme, setTheme, fontSize, setFontSize, accentColor, setAccentColor } = useSettings();

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium mb-4">Appearance</h3>

      <SettingItem label="Theme" description="Choose light or dark mode">
        <Select value={theme} onValueChange={setTheme}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
            <SelectItem value="system">System</SelectItem>
          </SelectContent>
        </Select>
      </SettingItem>

      <SettingItem label="Font size" description="Base font size for the interface">
        <div className="flex items-center gap-2">
          <Slider
            value={[fontSize]}
            onValueChange={([v]) => setFontSize(v)}
            min={12}
            max={20}
            step={1}
            className="w-24"
          />
          <span className="text-sm text-muted-foreground w-8">{fontSize}px</span>
        </div>
      </SettingItem>

      <SettingItem label="Accent color" description="Primary accent color">
        <div className="flex gap-1">
          {['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626'].map(color => (
            <button
              key={color}
              className={cn(
                "w-6 h-6 rounded-full",
                accentColor === color && "ring-2 ring-offset-2"
              )}
              style={{ backgroundColor: color }}
              onClick={() => setAccentColor(color)}
            />
          ))}
        </div>
      </SettingItem>
    </div>
  );
}
```

### Acceptance Criteria
- [ ] Theme switching works (light/dark/system)
- [ ] Font size adjustable
- [ ] Accent color selectable
- [ ] Changes apply immediately

---

## Feature 5: Editor Settings

### Goal
Allow customization of editor behavior.

### Implementation Details

```typescript
function EditorSettings() {
  const {
    useMathLive,
    setUseMathLive,
    autoCloseBrackets,
    setAutoCloseBrackets,
    lineNumbers,
    setLineNumbers,
    wordWrap,
    setWordWrap,
  } = useSettings();

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium mb-4">Editor</h3>

      <SettingItem
        label="Use MathLive for formulas"
        description="Enable interactive formula editing with MathLive"
      >
        <Switch checked={useMathLive} onCheckedChange={setUseMathLive} />
      </SettingItem>

      <SettingItem
        label="Auto-close brackets"
        description="Automatically close brackets and quotes"
      >
        <Switch checked={autoCloseBrackets} onCheckedChange={setAutoCloseBrackets} />
      </SettingItem>

      <SettingItem
        label="Line numbers in code"
        description="Show line numbers in code blocks"
      >
        <Switch checked={lineNumbers} onCheckedChange={setLineNumbers} />
      </SettingItem>

      <SettingItem
        label="Word wrap"
        description="Wrap long lines in the editor"
      >
        <Switch checked={wordWrap} onCheckedChange={setWordWrap} />
      </SettingItem>
    </div>
  );
}
```

### Acceptance Criteria
- [ ] All editor settings accessible
- [ ] Settings apply to editors
- [ ] Settings persist

---

## Feature 6: About Page

### Goal
Show app info, version, and credits.

### Implementation Details

```typescript
function AboutSettings() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <img src="/icon.png" alt="Lattice" className="w-16 h-16 rounded-xl" />
        <div>
          <h2 className="text-2xl font-bold">Lattice</h2>
          <p className="text-muted-foreground">Version 0.2.0</p>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        The ultimate zero-cost, local-first reading, annotation, editing, and
        note-taking solution for STEM users.
      </p>

      <div className="space-y-2">
        <h4 className="font-medium">Features</h4>
        <ul className="text-sm text-muted-foreground space-y-1">
          <li>• Multi-format file viewing (PDF, MD, Jupyter, Word, PPT)</li>
          <li>• PDF annotation with highlights, areas, and notes</li>
          <li>• Quantum keyboard for fast LaTeX input</li>
          <li>• Jupyter notebook editing with Pyodide</li>
          <li>• Desktop app with Tauri</li>
        </ul>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" asChild>
          <a href="https://github.com/your-repo" target="_blank">
            <Github className="h-4 w-4 mr-2" />
            GitHub
          </a>
        </Button>
        <Button variant="outline" asChild>
          <a href="https://your-docs" target="_blank">
            <BookOpen className="h-4 w-4 mr-2" />
            Documentation
          </a>
        </Button>
      </div>
    </div>
  );
}
```

### Acceptance Criteria
- [ ] Shows app version
- [ ] Links to GitHub/docs
- [ ] Clean layout

---

## Testing

### Manual Checklist

1. **Settings Button Location**
   - Verify settings button in sidebar footer (bottom-left)
   - Click opens settings dialog

2. **Keyboard Shortcuts**
   - Ctrl+, opens settings
   - Ctrl+B toggles sidebar
   - Escape closes settings

3. **Sidebar Collapse**
   - Click collapse button
   - Verify icons-only mode
   - Hover shows tooltips on right
   - Click expand restores

4. **Settings Persistence**
   - Change theme
   - Close and reopen app
   - Verify theme persisted

---

## Notes

- Follow Obsidian's visual language for familiarity
- Keep settings organized by category
- Use clear labels and descriptions
- Test keyboard navigation in settings
