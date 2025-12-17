# Fuel Can Packer

Static web app that computes optimal transfers between MSR 110g, 227g, and 450g fuel canisters to minimize the empty weight you carry. Everything runs client-side using Z3.wasm via the `z3-solver` npm package.

## Development
- Install dependencies: `npm install`
- Build once: `npm run bundle`
- Watch for changes: `npm run bundle:watch`
- Run tests: `npm test`
- Serve locally with COOP/COEP headers (run a build first): `npm start`
- Full production build and site assembly (outputs to `_site/`): `npm run build:deploy`

## Deployment
`wrangler deploy` will install dependencies, build, and publish the static site from `_site/` using the commands in `wrangler.toml`.
