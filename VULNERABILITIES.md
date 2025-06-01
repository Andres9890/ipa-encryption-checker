innerHTML

Impact: Processing a remote error message from a maliciously crafted response may result in arbitrary code execution in the context of the user’s browser.

Description: A DOM-based cross-site scripting (DOMXSS) vulnerability existed in the way error messages were injected into the page using innerHTML. The issue was addressed by replacing dynamic HTML injection with safe DOM manipulation using textContent and createElement.

Fixed by: Andres99

On: 2025, June 1st

In commit: [`edf3179`](https://github.com/Andres9890/ipa-encryption-checker/commit/edf3179a1fbf998942df9e0670a98d2f66c496e9)

----
