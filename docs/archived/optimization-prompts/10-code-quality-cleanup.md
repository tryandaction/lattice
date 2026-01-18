# Prompt 10: Code Quality and Cleanup

## Priority: P3 (Low)

## Context

After rapid development, the codebase has accumulated technical debt. This prompt focuses on code quality improvements, consistency, and maintainability.

## Areas to Review

### 1. TypeScript Strictness
- Enable stricter TypeScript options
- Fix any `any` types
- Add missing type annotations
- Ensure proper null checks

### 2. Component Organization
- Consistent file naming
- Proper component separation
- Shared component extraction
- Props interface consistency

### 3. State Management
- Store organization
- Action naming conventions
- Selector optimization
- State normalization

### 4. Error Handling
- Consistent error boundaries
- Proper error messages
- Error logging
- Recovery mechanisms

### 5. Testing Coverage
- Add missing unit tests
- Property-based test coverage
- Integration test gaps
- Test organization

## Tasks

### Task 1: TypeScript Improvements
```
1. Review tsconfig.json for stricter options
2. Run `tsc --noEmit` and fix all errors
3. Replace `any` types with proper types
4. Add JSDoc comments to public APIs
5. Enable strict null checks
```

### Task 2: Component Cleanup
```
1. Audit component file structure
2. Extract shared UI components
3. Standardize props interfaces
4. Remove unused components
5. Add component documentation
```

### Task 3: State Management Cleanup
```
1. Review store organization
2. Standardize action naming
3. Optimize selectors with reselect
4. Remove redundant state
5. Add store documentation
```

### Task 4: Error Handling Improvements
```
1. Add error boundaries to all routes
2. Standardize error message format
3. Implement error logging service
4. Add user-friendly error displays
5. Implement error recovery flows
```

### Task 5: Test Coverage
```
1. Run coverage report
2. Add tests for uncovered code
3. Add property tests for core logic
4. Organize test files consistently
5. Add integration tests for flows
```

## Files to Review

### High Priority
```
src/stores/*.ts - State management
src/hooks/*.ts - Custom hooks
src/lib/*.ts - Utility functions
src/types/*.ts - Type definitions
```

### Medium Priority
```
src/components/renderers/*.tsx - File viewers
src/components/editor/*.tsx - Editor components
src/components/main-area/*.tsx - Layout components
```

### Low Priority
```
src/components/ui/*.tsx - UI primitives
src/components/explorer/*.tsx - File explorer
src/components/settings/*.tsx - Settings UI
```

## Code Style Guidelines

### Naming Conventions
```typescript
// Components: PascalCase
export function MyComponent() {}

// Hooks: camelCase with use prefix
export function useMyHook() {}

// Utilities: camelCase
export function myUtility() {}

// Constants: SCREAMING_SNAKE_CASE
export const MY_CONSTANT = 'value';

// Types/Interfaces: PascalCase
export interface MyInterface {}
export type MyType = {};
```

### File Organization
```
src/
├── app/           # Next.js pages
├── components/    # React components
│   ├── ui/        # Reusable UI primitives
│   ├── layout/    # Layout components
│   └── [feature]/ # Feature-specific components
├── hooks/         # Custom React hooks
├── lib/           # Utility functions
├── stores/        # Zustand stores
├── types/         # TypeScript types
└── workers/       # Web workers
```

### Component Structure
```typescript
// 1. Imports
import { useState } from 'react';
import { cn } from '@/lib/utils';

// 2. Types
interface MyComponentProps {
  title: string;
  onAction?: () => void;
}

// 3. Component
export function MyComponent({ title, onAction }: MyComponentProps) {
  // 3a. Hooks
  const [state, setState] = useState(false);
  
  // 3b. Derived state
  const derivedValue = useMemo(() => compute(state), [state]);
  
  // 3c. Handlers
  const handleClick = useCallback(() => {
    setState(true);
    onAction?.();
  }, [onAction]);
  
  // 3d. Effects
  useEffect(() => {
    // side effects
  }, []);
  
  // 3e. Render
  return (
    <div className={cn('base-class', state && 'active-class')}>
      {title}
    </div>
  );
}
```

## Acceptance Criteria

- [ ] No TypeScript errors with strict mode
- [ ] No ESLint warnings
- [ ] Test coverage > 70%
- [ ] All public APIs documented
- [ ] Consistent code style throughout

## Commands

```bash
# Type checking
npx tsc --noEmit

# Linting
npm run lint

# Test coverage
npm run test:run -- --coverage

# Find unused exports
npx ts-prune

# Find duplicate code
npx jscpd src/
```

## Refactoring Checklist

- [ ] Remove console.log statements
- [ ] Remove commented-out code
- [ ] Remove unused imports
- [ ] Remove unused variables
- [ ] Remove unused functions
- [ ] Remove unused components
- [ ] Remove unused types
- [ ] Fix TODO comments or create issues
- [ ] Update outdated comments
- [ ] Simplify complex functions

## Notes

- Make small, focused commits
- Run tests after each change
- Document breaking changes
- Update related documentation
- Consider backwards compatibility
