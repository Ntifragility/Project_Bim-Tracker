# spec/vectors — golden test vectors (shared by legacy JS and Rust)

Each acceptance table from `docs/specs/<module>/<feature>.md` is stored here
as JSON. The same vectors run against the legacy JS (proving they describe
real behaviour) and the Rust crate (proving parity). A feature is done when
the vectors pass in Rust (ARCHITECTURE section 6).
