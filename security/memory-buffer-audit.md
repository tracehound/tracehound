# Memory / Buffer Security

- No usage of Buffer.allocUnsafe
- TypedArray → no out-of-bounds
- Bounded binary parsing

```
grep -R "allocUnsafe" .
```

If any exist, provide justification.
