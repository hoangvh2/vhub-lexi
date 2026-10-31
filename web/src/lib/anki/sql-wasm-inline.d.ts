// sql.js ships this single-file build (WebAssembly inlined) without its own type declaration.
declare module "sql.js/dist/sql-wasm-inline.js" {
  import type initSqlJs from "sql.js";
  const init: typeof initSqlJs;
  export default init;
}
