# Contributing to Oath Light

First off, thank you for considering contributing to Oath Light! It's people like you that make Oath Light such a great tool for personal growth.

## Code of Conduct

This project and everyone participating in it is governed by our commitment to creating a welcoming and inclusive environment. By participating, you are expected to uphold this standard. (GPL V3 license)

## How Can I Contribute?

Email me at: **abdelhamidalielsebaie@gmail.com**

### Reporting Bugs

Before creating bug reports, please check the existing issues as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

* **Use a clear and descriptive title**
* **Describe the exact steps to reproduce the problem**
* **Provide specific examples to demonstrate the steps**
* **Describe the behavior you observed after following the steps**
* **Explain which behavior you expected to see instead and why**
* **Include screenshots if possible**
* **Include browser version and operating system**
* **Include console error messages**

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, please include:

* **Use a clear and descriptive title**
* **Provide a step-by-step description of the suggested enhancement**
* **Provide specific examples to demonstrate the steps**
* **Describe the current behavior and explain which behavior you expected to see instead**
* **Explain why this enhancement would be useful**

### Pull Requests

* Fill in the required template
* Do not include issue numbers in the PR title
* Follow the JavaScript style guide
* Include thoughtfully-worded, well-structured tests
* Document new code
* End all files with a newline

#### HTML/CSS Style

* Use semantic HTML5 elements
* Use BEM naming convention for CSS classes
* Keep CSS organized and commented
* Use CSS variables for colors and spacing

#### Commit Messages

* Use the present tense ("Add feature" not "Added feature")
* Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
* Limit the first line to 72 characters or less
* Reference issues and pull requests liberally after the first line

### Testing

* Write tests for new features
* Ensure all tests pass before submitting PR
* Test in multiple browsers if possible
* Check console for errors
* Test with different blocklist sizes

### Documentation

* Update README.md if needed
* Add/update JSDoc comments
* Update CHANGELOG.md
* Create/update guides in Guides/ folder

## Project Structure

```
oath-light/
├── extension/                 # Browser extension
│   ├── manifest.json          # Extension configuration
│   ├── background.js          # Service worker
│   ├── content.js             # Content script
│   ├── popup.html/js          # Extension popup
│   ├── blocked.html/js        # Blocked page
│   ├── blocklists.html/js     # Blocklist manager
│   ├── blocklists/            # Blocklist data
│   └── icons/                 # Extension icons
├── desktop-app/               # Desktop application
├── Guides/                    # Documentation
└── test-blocklists.html       # Test suite
```

## Adding New Features

### Checklist

- [ ] Feature is well-defined and scoped
- [ ] Code follows project style guide
- [ ] Tests are added/updated
- [ ] Documentation is added/updated
- [ ] CHANGELOG.md is updated
- [ ] No console errors
- [ ] Works in Chrome and Firefox
- [ ] Performance impact is minimal

### Example: Adding a New Blocklist Category

1. Update data structure in `blocklists/`
2. Update loading logic in `background.js`
3. Update UI in `blocklists.html/js`
4. Add tests in `test-blocklists.html`
5. Update documentation
6. Test thoroughly

## Improving Blocklists

**List contributions are the single highest-value thing an outside contributor
can send.** No vendor's internal team can keep up with the web; a community
can. This is how uBlock Origin won its category, and it is the plan's item 3.6.

Because of that, list PRs get their own automated review
(`.github/workflows/list-pr.yml`) that runs before a human looks at anything.
You can run exactly what CI runs, locally, before you push:

```bash
node scripts/ci/validate-blocklists.mjs          # file shape
node scripts/ci/check-list-pr.mjs --base main    # review of your diff
node extension/tests/run-all.cjs                 # the full matcher suite
```

The review posts a summary (added/removed counts, per-domain verdicts) to the
workflow's job summary on your PR's Checks tab.

### Adding domains to the blocklist

Add entries to one of `extension/blocklists/domains_part1.json`,
`domains_part2.json`, `domains_part3.json`, or — for AI-erotica sites —
`domains_ai.json`. Each file is `{ "domains": [...] }`; `domains_ai.json` also
carries a `category`.

Every **newly added** domain must:

1. **Be a bare domain, lowercase.** `example.com`, not `https://example.com/x`,
   not `Example.com`. Subdomains are fine (`sub.example.com`).
2. **Not collide with the allowlist floor.** `WHITELIST_DOMAINS` in
   `extension/bg/matching.js` lists domains the matcher explicitly protects —
   an entry that collides with one is dead on arrival *and* a sign something
   has gone wrong upstream. This is the check that most matters: the worst
   thing a bad list PR can do is break a mainstream site for every user.
3. **Not be a public suffix or shared-hosting root.** `com`, `blogspot.com`,
   `vercel.app` and friends are rejected — blocking one takes out every site
   underneath it. Block the specific subdomain instead.
4. **Not already be covered.** If `example.com` is already listed,
   `sub.example.com` is redundant (the matcher walks parent domains). You'll
   get a warning, not a rejection.

Removals are welcome and are **never** blocked by the gate. A domain that was
wrongly listed is a real bug — see [BYPASSES.md](BYPASSES.md), which counts
false positives as in-scope reports for exactly this reason.

### Adding keywords

Keywords are matched as substrings against hostnames, which makes them far
riskier than a domain entry: one bad stem can Scunthorpe thousands of
legitimate sites. Before proposing one:

1. Check it against `KEYWORD_WHITELIST_WORDS` in `extension/bg/matching.js` —
   the trap-word list that already exists precisely because of past collisions.
2. Run `node extension/tests/run-all.cjs`. The domain corpus and adversarial
   suites (600+ cases) are what will catch a collision you didn't think of.
3. Say in the PR *why* the stem is safe, not just what it catches. A stem that
   only works as a compound (`aigirlfriend`, never bare `girlfriend`) belongs
   in `KEYWORD_COMPOUNDS`, not in the stem list — there are worked examples in
   the comments there.

## Performance Considerations

* Minimize DOM operations
* Use debouncing for search
* Avoid blocking the main thread
* Profile performance changes

## Security Considerations

* Never store passwords in plain text
* Validate all user input
* Sanitize HTML output
* Use Content Security Policy
* Follow principle of least privilege

## Questions?

Feel free to open an issue with your question or reach out to the maintainers.

## Recognition

Contributors will be recognized Here.

Thank you for contributing to Oath Light! ❤️
