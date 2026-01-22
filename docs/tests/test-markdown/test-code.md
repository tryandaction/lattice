# Code Blocks Test

## Python

```python
def hello_world():
    """A simple docstring."""
    print("Hello, World!")
    return 42

class MyClass:
    def __init__(self, name):
        self.name = name
```

## JavaScript

```javascript
const greeting = (name) => {
  console.log(`Hello, ${name}!`);
  return true;
};

// Arrow function
const add = (a, b) => a + b;
```

## TypeScript

```typescript
interface User {
  id: number;
  name: string;
  email?: string;
}

function processUser(user: User): void {
  console.log(user.name);
}
```

## Rust

```rust
fn main() {
    println!("Hello, world!");

    let x = 5;
    let y = {
        let x = 3;
        x + 1
    };
}
```

## C++

```cpp
#include <iostream>

int main() {
    std::cout << "Hello, World!" << std::endl;
    return 0;
}
```

## JSON

```json
{
  "name": "Test",
  "version": "1.0.0",
  "dependencies": {
    "react": "^18.0.0"
  }
}
```

## Inline Code

Use the `console.log()` function to print output. The `useState` hook is powerful.
