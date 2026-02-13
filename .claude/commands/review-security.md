Review the code changes on the current branch for security vulnerabilities.

## Instructions

1. Run `git diff main...HEAD` to see all changes on this branch.
2. For each changed file, read the full file to understand context.
3. Check for OWASP Top 10 and common web security issues:
   - **Injection**: SQL injection, command injection, XSS, template injection
   - **Auth/Access**: Broken authentication, missing authorization checks, IDOR
   - **Data exposure**: Secrets in code, sensitive data in logs, PII leaks
   - **SSRF**: Unvalidated URLs, DNS rebinding gaps
   - **Input validation**: Missing sanitization at system boundaries
   - **Dependency risks**: Known vulnerable packages (check package.json changes)
   - **Cryptography**: Weak algorithms, hardcoded keys, insecure randomness
   - **Rate limiting**: Missing or bypassable rate limits on sensitive endpoints
4. Rate each finding as **critical**, **high**, **medium**, or **low**.
5. Output a summary table with file, line, severity, vulnerability type, and description.
6. For each critical/high finding, suggest a specific fix.
7. If no issues are found, say so clearly.

Assume the application is internet-facing. Err on the side of flagging potential issues.
