# Dynamic Execution & RCE Surface

Produce evidence throughout the repo:

- eval / new Function / vm / dynamic import
- child_process / exec / spawn / shell
- boundary for any native addons

Command:

```
grep -R "eval\|Function(\|vm\.\|child_process\|exec(" .
```

Prototype pollution in Node.js can lead to real RCE; investigate this specifically.
