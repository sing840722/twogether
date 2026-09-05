# Twogether

A small, private, static couple-question app designed for iPhone and GitHub Pages.

## How it works

- Both people use the same Couple ID and shared password.
- Each person's answers are encrypted and stored only in that phone's browser.
- Tap **Share my answers** to send an encrypted link through Messages.
- The other person opens the link, enters the shared password, and saves the encrypted answers.
- Sit together and tap **Reveal together**.

There is no account, database, analytics, or server-side code. Because GitHub Pages is static, entering an ID alone cannot sync two phones; exchanging the encrypted link is the sync step.

## Publish on GitHub Pages

1. Create a new GitHub repository and upload the contents of this folder.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select the `main` branch and `/ (root)`, then save.
5. Open the Pages URL on each iPhone. In Safari, use **Share → Add to Home Screen** for an app-like icon.

## Run locally

Serve the folder over HTTP (Web Crypto and the service worker require a secure context in normal use):

```powershell
node dev-server.mjs
```

Then open `http://localhost:4173`.

## Privacy notes

The password is never stored. Answers at rest and answer links use AES-GCM encryption with a key derived by PBKDF2-SHA256. A weak password can still be guessed from a captured answer link, so use a unique password that is not a name or birthday. Clearing Safari website data erases locally stored answers.
