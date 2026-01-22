# Integrated Test Document

This document tests the integration of code blocks, tables, and other markdown elements in the decoration coordinator.

## Section 1: Code Blocks

Here's a Python function:

```python
def fibonacci(n):
    """Calculate Fibonacci number."""
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

# Test the function
for i in range(10):
    print(f"F({i}) = {fibonacci(i)}")
```

## Section 2: Tables

Here's a comparison table:

| Language | Type | Performance | Ease of Use |
|----------|------|-------------|-------------|
| Python | Interpreted | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| JavaScript | Interpreted | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| Rust | Compiled | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| Go | Compiled | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

## Section 3: Mixed Content

### Code with Explanation

The following TypeScript code demonstrates a generic function:

```typescript
function identity<T>(arg: T): T {
    return arg;
}

// Usage examples
const num = identity<number>(42);
const str = identity<string>("Hello");
```

### Feature Comparison Table

| Feature | **Code Blocks** | **Tables** | **Math** |
|---------|----------------|-----------|----------|
| Syntax Highlighting | ✅ | ❌ | ❌ |
| Line Numbers | ✅ | ❌ | ❌ |
| Copy Button | ✅ | ❌ | ❌ |
| Inline Formatting | ❌ | ✅ | ✅ |
| Formula Rendering | ❌ | ✅ | ✅ |

### Inline Elements

This paragraph contains **bold text**, *italic text*, `inline code`, and a formula: $E=mc^2$.

## Section 4: Complex Table with Code

| Language | Example Code | Output |
|----------|--------------|--------|
| Python | `print("Hello")` | Hello |
| JavaScript | `console.log("Hi")` | Hi |
| Rust | `println!("Hey")` | Hey |

## Section 5: Nested Structures

### List with Code

1. First, install dependencies:
   ```bash
   npm install
   ```

2. Then, run the development server:
   ```bash
   npm run dev
   ```

3. Finally, open your browser to `http://localhost:3000`

### Table with Math

| Formula | Description | Value |
|---------|-------------|-------|
| $a^2 + b^2 = c^2$ | Pythagorean theorem | Geometric |
| $E = mc^2$ | Mass-energy equivalence | $9 \times 10^{16}$ J/kg |
| $F = ma$ | Newton's second law | Force |

## Section 6: Large Code Block

```javascript
// React component example
import React, { useState, useEffect } from 'react';

function Counter() {
  const [count, setCount] = useState(0);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    let interval;
    if (isRunning) {
      interval = setInterval(() => {
        setCount(c => c + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isRunning]);

  return (
    <div className="counter">
      <h1>Count: {count}</h1>
      <button onClick={() => setIsRunning(!isRunning)}>
        {isRunning ? 'Stop' : 'Start'}
      </button>
      <button onClick={() => setCount(0)}>Reset</button>
    </div>
  );
}

export default Counter;
```

## Section 7: Wide Table

| ID | Name | Email | Role | Department | Status | Join Date |
|----|------|-------|------|------------|--------|-----------|
| 1 | Alice | alice@example.com | **Admin** | Engineering | ✅ Active | 2023-01-15 |
| 2 | Bob | bob@example.com | *Developer* | Engineering | ✅ Active | 2023-02-20 |
| 3 | Carol | carol@example.com | Designer | Design | ✅ Active | 2023-03-10 |
| 4 | Dave | dave@example.com | Manager | Operations | ⏸️ Leave | 2023-04-05 |

## Section 8: Code Block Followed by Table

Here's a SQL query:

```sql
SELECT
    users.name,
    COUNT(orders.id) as order_count,
    SUM(orders.total) as total_spent
FROM users
LEFT JOIN orders ON users.id = orders.user_id
GROUP BY users.id
HAVING order_count > 5
ORDER BY total_spent DESC;
```

And here's the result:

| Name | Order Count | Total Spent |
|------|-------------|-------------|
| Alice | 12 | $1,234.56 |
| Bob | 8 | $987.65 |
| Carol | 6 | $543.21 |

## Section 9: Multiple Languages

### Python

```python
def quicksort(arr):
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quicksort(left) + middle + quicksort(right)
```

### Rust

```rust
fn quicksort<T: Ord>(arr: &mut [T]) {
    if arr.len() <= 1 {
        return;
    }
    let pivot = partition(arr);
    quicksort(&mut arr[0..pivot]);
    quicksort(&mut arr[pivot + 1..]);
}
```

### Performance Comparison

| Language | Time (ms) | Memory (MB) | Lines of Code |
|----------|-----------|-------------|---------------|
| Python | 125 | 45 | 8 |
| Rust | 12 | 5 | 15 |
| JavaScript | 89 | 32 | 10 |

## Conclusion

This document demonstrates the successful integration of:
- ✅ Code blocks with syntax highlighting
- ✅ Tables with inline formatting
- ✅ Mixed content rendering
- ✅ Proper cursor context handling
