# Fuel Can Packer

Static web app that computes optimal transfers between MSR 110g, 227g, and 450g fuel canisters to minimize the empty weight you carry. Everything runs client-side using a custom TypeScript solver in a Web Worker.

See [ALGORITHM.md](ALGORITHM.md) (published as [algorithm.html](algorithm.html)) for detailed documentation on the optimization algorithm, complexity analysis, and performance characteristics.

## Development
- Install dependencies: `pnpm install`
- Build once: `pnpm run bundle`
- Watch for changes: `pnpm run bundle:watch`
- Run tests: `pnpm test`
- Serve locally with COOP/COEP headers (run a build first): `pnpm start`
- Full production build and site assembly (outputs to `_site/`): `pnpm run build:deploy`

## Deployment
`wrangler deploy` will install dependencies, build, and publish the static site from `_site/` using the commands in `wrangler.toml`.
