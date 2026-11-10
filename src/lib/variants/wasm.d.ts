// wrangler (and the Workers vitest pool) import `.wasm` files as compiled WebAssembly modules.
declare module "*.wasm" {
   const module: WebAssembly.Module;
   export default module;
}
