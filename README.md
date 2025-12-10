# Fuel Can Packer

Interactive CLI that uses Z3 to plan how to consolidate MSR fuel canisters to minimize what you carry.

## Features
- Supports MSR 110g, 227g, and 450g canisters; enter gross weights in grams.
- Finds an optimal set of cans to carry minimizing empty can weight.
- Secondary/tertiary objectives: minimize donor→recipient pairings, then total fuel transferred.
- Prints transfer plan and final fuel/gross weight for every can (including empties left behind).
- Static webpage uses Z3.wasm (via the `z3-solver` npm package) to compute the same optimal plan in-browser.

## Usage
```bash
cargo run
```
Then enter space-separated gross weights per size when prompted. Leave blank if you have none of a size.

Example:
```
Fuel can packer (MSR only)
Enter gross weights (g) for each size, space separated. Leave blank if none.

Gross weights for 110g cans: 129 161
Gross weights for 227g cans: 295 208 230 199 263 229
Gross weights for 450g cans:
Detected total fuel: 630 g across 8 cans.

Transfer plan:
- Can #5 (230g start) (MSR 227g): add 143 g -> target fuel 226 g (gross 373 g, start gross 230 g)
    from Can #8 (229g start) (MSR 227g): 82 g
    from Can #4 (208g start) (MSR 227g): 61 g
- Can #7 (263g start) (MSR 227g): add 88 g -> target fuel 204 g (gross 351 g, start gross 263 g)
    from Can #2 (161g start) (MSR 110g): 60 g
    from Can #1 (129g start) (MSR 110g): 28 g
- Can #3 (295g start) (MSR 227g): add 52 g -> target fuel 200 g (gross 347 g, start gross 295 g)
    from Can #6 (199g start) (MSR 227g): 52 g

Carry 3 cans, total gross weight 1071 g.

Final fuel per can (including empties):
- Can #1 (129g start) (MSR 110g): start gross 129 g, final fuel 0 g, final gross 101 g (left behind)
- Can #2 (161g start) (MSR 110g): start gross 161 g, final fuel 0 g, final gross 101 g (left behind)
- Can #3 (295g start) (MSR 227g): start gross 295 g, final fuel 200 g, final gross 347 g
- Can #4 (208g start) (MSR 227g): start gross 208 g, final fuel 0 g, final gross 147 g (left behind)
- Can #5 (230g start) (MSR 227g): start gross 230 g, final fuel 226 g, final gross 373 g
- Can #6 (199g start) (MSR 227g): start gross 199 g, final fuel 0 g, final gross 147 g (left behind)
- Can #7 (263g start) (MSR 227g): start gross 263 g, final fuel 204 g, final gross 351 g
- Can #8 (229g start) (MSR 227g): start gross 229 g, final fuel 0 g, final gross 147 g (left behind)
```

## Browser UI (Z3.wasm)
- Inside `web/`: install deps and build the browser bundle (creates `z3-solver-browser.js` and copies Z3 wasm assets):  
  `cd web && npm install && npm run build`
- Start the local server that sets COOP/COEP headers (required for Z3’s threaded wasm):  
  `npm start` then open `http://localhost:3000`
- Enter space-separated gross weights per size; the page runs the same Z3 optimization in-browser and prints the transfer plan.

## Notes
- Input weights must be integers (grams). Values lighter than the empty weight error out.
- The CLI solver uses Z3 via the `z3` crate; objectives are solved lexicographically.
- The browser UI uses the `z3-solver` npm package (bundled Z3.wasm) for identical optimization results.
- Only MSR weights are encoded (from the provided reference table).
