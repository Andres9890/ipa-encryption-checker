innerHTML

Impact: Processing a remote error message from a maliciously crafted response may result in arbitrary code execution in the context of the user’s browser.

Description: A DOM-based cross-site scripting (DOMXSS) vulnerability existed in the way error messages were injected into the page using innerHTML. The issue was addressed by replacing dynamic HTML injection with safe DOM manipulation using textContent and createElement.

Fixed by: Andres99

On: 2025, June 1st

----
