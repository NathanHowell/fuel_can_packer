# Fuel Can Packer

Interactive CLI that uses Z3 to plan how to consolidate MSR fuel canisters to minimize what you carry.

## Features
- Supports MSR 110g, 227g, and 450g canisters; enter gross weights in grams.
- Finds an optimal set of cans to carry minimizing empty can weight.
- Secondary/tertiary objectives: minimize donor→recipient pairings, then total fuel transferred.
- Prints transfer plan and final fuel/gross weight for every can (including empties left behind).

## Usage
```bash
cargo run
```
Then enter space-separated gross weights per size when prompted. Leave blank if you have none of a size.

Example:
```
Gross weights for 110g cans: 129 161
Gross weights for 227g cans: 295 208 230 199 263 229
Gross weights for 450g cans:
```

## Notes
- Input weights must be integers (grams). Values lighter than the empty weight error out.
- Solver uses Z3 via the `z3` crate; objectives are solved lexicographically.
- Only MSR weights are encoded (from the provided reference table).
