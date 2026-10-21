//! `conduit-wasm`: thin wasm-bindgen layer over `conduit-core`.
//!
//! Empty scaffold (task 1.1). Exposes plain data types only (serde-JSON for
//! small payloads, typed arrays for bulk geometry); never panics on expected
//! errors (ARCHITECTURE section 3). Real implementation in `rust/conduit-wasm`.

#[cfg(test)]
mod tests {
    #[test]
    fn scaffold_compiles() {}
}
