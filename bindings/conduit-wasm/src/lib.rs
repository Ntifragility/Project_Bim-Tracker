//! `conduit-wasm`: thin wasm-bindgen layer over `conduit-core`.
//!
//! Empty scaffold (task 1.1). Exposes plain data types only (serde-JSON for
//! small payloads, typed arrays for bulk geometry); never panics on expected
//! errors (ARCHITECTURE section 3). Real implementation in `rust/conduit-wasm`.

use wasm_bindgen::prelude::*;

/// Scaffold entry point so `wasm-pack build` has a real export to verify.
#[wasm_bindgen]
pub fn conduit_wasm_version() -> String {
    "conduit-wasm scaffold (task 1.1)".to_string()
}

#[cfg(test)]
mod tests {
    #[test]
    fn scaffold_compiles() {}
}
