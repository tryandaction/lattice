# Prompt 06: File Management Pro - Folders & Extensions

## Priority: P2 (Medium)

## Overview

Enhance file management capabilities to allow users to **create new folders** and **rename file extensions** to change file types. These features are essential for organizing research materials and converting notes between formats.

---

## Related Files

- `src/components/sidebar/file-browser.tsx` - File browser
- `src/components/sidebar/file-tree.tsx` - Tree view
- `src/components/sidebar/file-item.tsx` - Individual file
- `src/lib/file-utils.ts` - File utilities
- `src/hooks/use-file-system.ts` - File system hook
- `src/types/file-system.ts` - Type definitions

---

## Feature 1: Create New Folder

### Goal
Allow users to create new folders within their workspace.

### Implementation Details

#### 1.1 UI for New Folder
```typescript
// In file-browser.tsx header
function FolderActions({ currentPath, onCreateFolder }) {
  const [showInput, setShowInput] = useState(false);
  const [folderName, setFolderName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleCreate = async () => {
    if (!folderName.trim()) return;

    try {
      await onCreateFolder(currentPath, folderName.trim());
      setFolderName('');
      setShowInput(false);
    } catch (error) {
      toast.error(`Failed to create folder: ${error.message}`);
    }
  };

  if (showInput) {
    return (
      <div className="flex items-center gap-1 px-2 py-1">
        <Folder className="h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCreate();
            if (e.key === 'Escape') setShowInput(false);
          }}
          placeholder="Folder name"
          className="h-6 text-sm"
          autoFocus
        />
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleCreate}>
          <Check className="h-3 w-3" />
        </Button>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setShowInput(false)}>
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      onClick={() => {
        setShowInput(true);
        setTimeout(() => inputRef.current?.focus(), 0);
      }}
      title="New folder"
    >
      <FolderPlus className="h-4 w-4" />
    </Button>
  );
}
```

#### 1.2 File System API for Creating Folder
```typescript
// In use-file-system.ts
export async function createFolder(
  parentHandle: FileSystemDirectoryHandle,
  folderName: string
): Promise<FileSystemDirectoryHandle> {
  // Validate folder name
  if (!folderName || folderName.includes('/') || folderName.includes('\\')) {
    throw new Error('Invalid folder name');
  }

  // Check if already exists
  try {
    const existing = await parentHandle.getDirectoryHandle(folderName, { create: false });
    if (existing) {
      throw new Error('Folder already exists');
    }
  } catch (e) {
    if (e.name !== 'NotFoundError') throw e;
  }

  // Create the folder
  return await parentHandle.getDirectoryHandle(folderName, { create: true });
}
```

#### 1.3 Context Menu Option
```typescript
// Add to folder context menu
const folderContextMenu = [
  {
    label: 'New Folder',
    icon: FolderPlus,
    shortcut: 'Shift+Ctrl+N',
    action: () => setShowNewFolderInput(true),
  },
  {
    label: 'New File',
    icon: FilePlus,
    shortcut: 'Ctrl+N',
    action: () => setShowNewFileInput(true),
  },
  // ... other options
];
```

### Acceptance Criteria
- [ ] Can create folder via button in toolbar
- [ ] Can create folder via context menu on folder
- [ ] Folder name validated (no special chars)
- [ ] Error shown if folder exists
- [ ] New folder appears in tree immediately
- [ ] Keyboard shortcut works (Shift+Ctrl+N)

---

## Feature 2: Rename Files/Folders

### Goal
Allow renaming files and folders, including changing extensions.

### Implementation Details

#### 2.1 Inline Rename UI
```typescript
// In file-item.tsx
function FileItem({ file, onRename, onDelete }) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(file.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleRename = async () => {
    if (!newName.trim() || newName === file.name) {
      setIsRenaming(false);
      return;
    }

    try {
      await onRename(file, newName.trim());
      setIsRenaming(false);
    } catch (error) {
      toast.error(`Failed to rename: ${error.message}`);
      setNewName(file.name); // Reset
    }
  };

  if (isRenaming) {
    return (
      <div className="flex items-center gap-1 px-2 py-1">
        <FileIcon type={file.type} className="h-4 w-4" />
        <Input
          ref={inputRef}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRename();
            if (e.key === 'Escape') {
              setNewName(file.name);
              setIsRenaming(false);
            }
          }}
          onBlur={handleRename}
          className="h-6 text-sm flex-1"
          autoFocus
        />
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2 px-2 py-1 hover:bg-muted cursor-pointer"
      onDoubleClick={() => setIsRenaming(true)}
    >
      <FileIcon type={file.type} className="h-4 w-4" />
      <span className="text-sm truncate">{file.name}</span>
    </div>
  );
}
```

#### 2.2 File System Rename API
```typescript
// In use-file-system.ts
export async function renameFile(
  parentHandle: FileSystemDirectoryHandle,
  oldName: string,
  newName: string
): Promise<void> {
  // Validate new name
  if (!newName || newName.includes('/') || newName.includes('\\')) {
    throw new Error('Invalid file name');
  }

  // Check if new name already exists
  try {
    await parentHandle.getFileHandle(newName, { create: false });
    throw new Error('A file with this name already exists');
  } catch (e) {
    if (e.name !== 'NotFoundError' && e.message !== 'A file with this name already exists') {
      throw e;
    }
    if (e.message === 'A file with this name already exists') {
      throw e;
    }
  }

  // Get old file
  const oldFile = await parentHandle.getFileHandle(oldName);
  const fileContent = await oldFile.getFile();
  const content = await fileContent.arrayBuffer();

  // Create new file with new name
  const newFile = await parentHandle.getFileHandle(newName, { create: true });
  const writable = await newFile.createWritable();
  await writable.write(content);
  await writable.close();

  // Delete old file
  await parentHandle.removeEntry(oldName);
}
```

#### 2.3 Extension Change Warning
```typescript
// Warn when changing extension
function RenameDialog({ file, onConfirm, onCancel }) {
  const [newName, setNewName] = useState(file.name);
  const oldExt = file.name.split('.').pop();
  const newExt = newName.split('.').pop();
  const extensionChanged = oldExt !== newExt;

  return (
    <Dialog>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename {file.name}</DialogTitle>
        </DialogHeader>

        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          autoFocus
        />

        {extensionChanged && (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Changing the extension from <code>.{oldExt}</code> to <code>.{newExt}</code> may
              change how the file is handled. The file contents will not be converted.
            </AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onConfirm(newName)}>Rename</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### Acceptance Criteria
- [ ] Double-click file enables rename mode
- [ ] F2 key also enables rename
- [ ] Can change file extension
- [ ] Warning shown when extension changes
- [ ] Enter confirms, Escape cancels
- [ ] Validation prevents invalid names

---

## Feature 3: Move Files/Folders

### Goal
Allow drag-and-drop to move files between folders.

### Implementation Details

#### 3.1 Drag and Drop in File Tree
```typescript
// In file-tree.tsx
function FileTreeItem({ file, path }) {
  const [{ isDragging }, drag] = useDrag({
    type: 'FILE',
    item: { file, sourcePath: path },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const [{ isOver }, drop] = useDrop({
    accept: 'FILE',
    drop: (item: { file: FileEntry; sourcePath: string }) => {
      if (file.type === 'directory') {
        moveFile(item.sourcePath, path);
      }
    },
    collect: (monitor) => ({
      isOver: monitor.isOver() && file.type === 'directory',
    }),
  });

  return (
    <div
      ref={(node) => drag(drop(node))}
      className={cn(
        "file-tree-item",
        isDragging && "opacity-50",
        isOver && "bg-accent"
      )}
    >
      {/* File content */}
    </div>
  );
}
```

#### 3.2 Move File API
```typescript
export async function moveFile(
  rootHandle: FileSystemDirectoryHandle,
  sourcePath: string,
  destFolderPath: string
): Promise<void> {
  // Parse paths
  const sourceDir = sourcePath.substring(0, sourcePath.lastIndexOf('/'));
  const fileName = sourcePath.substring(sourcePath.lastIndexOf('/') + 1);

  // Get handles
  const sourceDirHandle = await getDirectoryHandle(rootHandle, sourceDir);
  const destDirHandle = await getDirectoryHandle(rootHandle, destFolderPath);

  // Get file content
  const fileHandle = await sourceDirHandle.getFileHandle(fileName);
  const file = await fileHandle.getFile();
  const content = await file.arrayBuffer();

  // Create in destination
  const newHandle = await destDirHandle.getFileHandle(fileName, { create: true });
  const writable = await newHandle.createWritable();
  await writable.write(content);
  await writable.close();

  // Delete from source
  await sourceDirHandle.removeEntry(fileName);
}
```

### Acceptance Criteria
- [ ] Can drag files between folders
- [ ] Visual feedback during drag
- [ ] Drop indicator on valid targets
- [ ] File moves successfully
- [ ] Tree updates after move

---

## Feature 4: Delete Files/Folders

### Goal
Allow deleting files and folders with confirmation.

### Implementation Details

#### 4.1 Delete Confirmation
```typescript
function DeleteConfirmDialog({ item, onConfirm, onCancel }) {
  const isFolder = item.type === 'directory';

  return (
    <AlertDialog>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {isFolder ? 'Folder' : 'File'}</AlertDialogTitle>
          <AlertDialogDescription>
            {isFolder ? (
              <>
                Are you sure you want to delete the folder <strong>{item.name}</strong> and all its contents?
                This action cannot be undone.
              </>
            ) : (
              <>
                Are you sure you want to delete <strong>{item.name}</strong>?
                This action cannot be undone.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

#### 4.2 Delete API
```typescript
export async function deleteEntry(
  parentHandle: FileSystemDirectoryHandle,
  name: string,
  recursive: boolean = false
): Promise<void> {
  await parentHandle.removeEntry(name, { recursive });
}
```

#### 4.3 Keyboard Shortcut
```typescript
// Delete key deletes selected item
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'Delete' && selectedFile) {
      e.preventDefault();
      setShowDeleteConfirm(true);
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, [selectedFile]);
```

### Acceptance Criteria
- [ ] Context menu has "Delete" option
- [ ] Confirmation dialog appears
- [ ] Folder deletion warns about contents
- [ ] Delete key triggers delete
- [ ] Tree updates after delete

---

## Feature 5: File Type Conversion via Extension

### Goal
Allow changing file type by changing extension, with appropriate handling.

### Implementation Details

#### 5.1 Supported Conversions
```typescript
// Define which conversions are safe
const SAFE_CONVERSIONS: Record<string, string[]> = {
  'md': ['txt', 'markdown'],
  'txt': ['md', 'markdown'],
  'markdown': ['md', 'txt'],
  'json': ['txt'],
  'ipynb': ['json'],
};

function isConversionSafe(fromExt: string, toExt: string): boolean {
  return SAFE_CONVERSIONS[fromExt]?.includes(toExt) ?? false;
}
```

#### 5.2 Conversion Dialog
```typescript
function ConvertFileDialog({ file, newName, onConfirm, onCancel }) {
  const oldExt = file.name.split('.').pop()?.toLowerCase() || '';
  const newExt = newName.split('.').pop()?.toLowerCase() || '';
  const isSafe = isConversionSafe(oldExt, newExt);

  return (
    <Dialog>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change File Type</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            You are changing <code>{file.name}</code> to <code>{newName}</code>.
          </p>

          {isSafe ? (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                This is a text-based conversion. The file contents will remain the same,
                but it will be opened with a different editor.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="warning">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Converting from <code>.{oldExt}</code> to <code>.{newExt}</code> may cause issues.
                The file contents will NOT be converted. This only changes how Lattice
                interprets the file.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Current type:</span>
            <FileTypeIcon extension={oldExt} />
            <span>{getFileTypeLabel(oldExt)}</span>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">New type:</span>
            <FileTypeIcon extension={newExt} />
            <span>{getFileTypeLabel(newExt)}</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onConfirm(newName)}>
            Change Extension
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### Acceptance Criteria
- [ ] Extension change shows conversion dialog
- [ ] Safe conversions indicated
- [ ] Warning for potentially problematic conversions
- [ ] File type icon updates after change
- [ ] File opens with new editor type

---

## Feature 6: Keyboard Shortcuts Reference

### Shortcuts
| Action | Shortcut |
|--------|----------|
| New File | Ctrl+N |
| New Folder | Shift+Ctrl+N |
| Rename | F2 |
| Delete | Delete |
| Duplicate | Ctrl+D |
| Copy Path | Ctrl+Shift+C |

### Implementation
```typescript
const FILE_SHORTCUTS = {
  'Ctrl+N': 'newFile',
  'Shift+Ctrl+N': 'newFolder',
  'F2': 'rename',
  'Delete': 'delete',
  'Ctrl+D': 'duplicate',
  'Ctrl+Shift+C': 'copyPath',
};
```

---

## Testing

### Manual Checklist

1. **Create Folder**
   - Click new folder button
   - Enter name "test-folder"
   - Verify folder appears
   - Try creating duplicate name (should error)

2. **Rename File**
   - Double-click file name
   - Change name
   - Press Enter
   - Verify name changed

3. **Change Extension**
   - Rename "notes.txt" to "notes.md"
   - Verify warning shown
   - Confirm and verify file type changes

4. **Delete**
   - Select file
   - Press Delete
   - Confirm deletion
   - Verify file removed

5. **Move File**
   - Drag file to folder
   - Verify file moves
   - Drag folder to another folder
   - Verify nested correctly

---

## Notes

- Test with File System Access API limitations
- Consider fallback for unsupported browsers
- Handle permission errors gracefully
- Test with deeply nested structures
