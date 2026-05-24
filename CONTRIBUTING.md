# Contributing to Pure Path

First off, thank you for considering contributing to Pure Path! It's people like you that make Pure Path such a great tool for personal growth.

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
pure-path/
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

### Adding Domains

1. Research the domain thoroughly
2. Verify it's actually NSFW
3. Add to `blocklists/domains.json`
4. Keep list alphabetically sorted
5. Test that it blocks correctly

### Adding Keywords

1. Consider false positive rate
2. Test with real-world examples
3. Add to `blocklists/keywords.json`
4. Keep list alphabetically sorted
5. Test that it blocks correctly

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

Thank you for contributing to Pure Path! ❤️
