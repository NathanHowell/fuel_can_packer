# Fuel Can Packer

Static web app that computes optimal transfers between mixed isobutane fuel canisters to minimize the empty weight you carry. Choose your can types (defaults include MSR 110g/227g/450g) and everything runs client-side using a custom TypeScript solver in a Web Worker.

See [ALGORITHM.md](ALGORITHM.md) for detailed documentation on the optimization algorithm, complexity analysis, and performance characteristics.

## Development
- Install dependencies: `npm install`
- Build once: `npm run bundle`
- Watch for changes: `npm run bundle:watch`
- Run tests: `npm test`
- Serve locally with COOP/COEP headers (run a build first): `npm start`
- Full production build and site assembly (outputs to `_site/`): `npm run build:deploy`

## Deployment
`wrangler deploy` will install dependencies, build, and publish the static site from `_site/` using the commands in `wrangler.toml`.
