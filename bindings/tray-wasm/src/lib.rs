//! `tray-wasm`: thin wasm-bindgen layer over `tray-tagging` + `tray-routing`.
//!
//! Empty scaffold (task 1.1). Same boundary contract as `conduit-wasm`
//! (ARCHITECTURE section 3). Real implementation in `rust/tray-wasm`.

use wasm_bindgen::prelude::*;

/// Scaffold entry point so `wasm-pack build` has a real export to verify.
#[wasm_bindgen]
pub fn tray_wasm_version() -> String {
    "tray-wasm scaffold (task 1.1)".to_string()
}

#[cfg(test)]
mod tests {
    #[test]
    fn scaffold_compiles() {}
}
