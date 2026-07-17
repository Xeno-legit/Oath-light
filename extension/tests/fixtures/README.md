# Golden corpus fixtures

These JSON files are the single source of truth for keyword-engine test cases —
add new cases here, never to a single engine. Both the JS suite
(`extension/tests/test-domain-keywords.cjs`, loaded via `fs.readFileSync`) and
the Rust port (`cargo test -p oathlight-core`, loaded via `include_str!`)
consume the exact same file, so the two engines can never silently drift apart
on what a hostname should do.
