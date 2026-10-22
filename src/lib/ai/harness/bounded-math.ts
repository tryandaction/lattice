const unary: Record<string, (value: number) => number> = {
  sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, log: Math.log, log10: Math.log10,
  exp: Math.exp, floor: Math.floor, ceil: Math.ceil, round: Math.round,
};
const multiple: Record<string, (...values: number[]) => number> = { min: Math.min, max: Math.max, pow: Math.pow, hypot: Math.hypot };
/** A numeric grammar, not a JavaScript evaluator. Every input token is consumed. */
export function evaluateBoundedMath(expression: string): { engine: 'bounded-math'; expression: string; value: number } {
  if (!expression.trim() || expression.length > 2000) throw new Error('Numeric expression exceeds length budget.');
  const tokens = expression.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[a-zA-Z]+|\*\*|[()+\-*/%,]|\S/g) ?? [];
  if (tokens.length > 512) throw new Error('Numeric expression exceeds token budget.');
  let position = 0;
  function finite(value: number) { if (!Number.isFinite(value)) throw new Error('Numeric result is not finite.'); return value; }
  function primary(depth: number): number {
    if (depth > 48) throw new Error('Numeric expression exceeds nesting budget.');
    const token = tokens[position++];
    if (token === '(') { const value = sum(depth + 1); if (tokens[position++] !== ')') throw new Error('Unmatched numeric parentheses.'); return value; }
    if (token === 'pi') return Math.PI;
    if (token === 'e') return Math.E;
    if (token && /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(token)) return finite(Number(token));
    if (token && (Object.hasOwn(unary, token) || Object.hasOwn(multiple, token)) && tokens[position++] === '(') {
      const args = [sum(depth + 1)];
      while (tokens[position] === ',') { position++; if (args.length >= 32) throw new Error('Numeric function argument budget exceeded.'); args.push(sum(depth + 1)); }
      if (tokens[position++] !== ')' || Object.hasOwn(unary, token) && args.length !== 1 || token === 'pow' && args.length !== 2) throw new Error('Invalid numeric function arguments.');
      return finite(Object.hasOwn(unary, token) ? unary[token](args[0]) : multiple[token](...args));
    }
    throw new Error('Only numeric arithmetic and documented math functions are supported.');
  }
  function signed(depth: number): number {
    if (depth > 48) throw new Error('Numeric expression exceeds nesting budget.');
    if (tokens[position] === '+' || tokens[position] === '-') { const sign = tokens[position++]; return (sign === '-' ? -1 : 1) * signed(depth + 1); }
    return power(depth);
  }
  function power(depth: number): number {
    const value = primary(depth + 1);
    if (tokens[position] === '**') { position++; const exponent = signed(depth + 1); if (Math.abs(exponent) > 1024) throw new Error('Exponent exceeds numeric budget.'); return finite(value ** exponent); }
    return value;
  }
  function product(depth: number): number {
    let value = signed(depth);
    while (['*', '/', '%'].includes(tokens[position])) { const op = tokens[position++], right = signed(depth); value = finite(op === '*' ? value * right : op === '/' ? value / right : value % right); }
    return value;
  }
  function sum(depth: number): number {
    let value = product(depth);
    while (tokens[position] === '+' || tokens[position] === '-') { const op = tokens[position++], right = product(depth); value = finite(op === '+' ? value + right : value - right); }
    return value;
  }
  const value = finite(sum(0));
  if (position !== tokens.length) throw new Error('Unexpected numeric expression token.');
  return { engine: 'bounded-math', expression, value };
}
