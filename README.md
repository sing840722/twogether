# Twogether

A small, private, real-time couple-question app designed for iPhone. It can be hosted on GitHub Pages or Firebase Hosting.

## The flow

1. The first person enters their name and a private share code.
2. Twogether generates an invite link to send through Messages.
3. The second person opens the link and enters their own name.
4. Both answer questions on their own phone.
5. Either person can add a custom question, which appears live for both people.
6. Each screen updates live to show which questions both people answered.
7. Either person taps **Reveal this answer** and it opens on both screens at once.

Answers are saved to each person's Google account. To test both people on one computer, use two different browser profiles or an incognito window so each tab can sign in with a different account.

## Architecture and privacy

- Static HTML, CSS, and JavaScript front end.
- Firebase Authentication provides Google sign-in.
- Cloud Firestore saves rooms, custom questions, readiness, and revealed answers and synchronizes them live.
- Each unrevealed answer is stored in a private document that Firestore rules allow only its author to read.
- When reveal is requested, each signed-in client publishes its own answer to the shared question. Neither person can fetch the other's private answer directly.
- The Firebase configuration in `firebase-config.js` identifies the public web app; it is not a secret. Firestore rules provide the data security boundary.

## Publish on GitHub Pages

1. Open **Settings → Pages** in the GitHub repository.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select the `main` branch and `/ (root)`, then save.
4. In iPhone Safari, use **Share → Add to Home Screen**.

In Firebase Authentication, add `sing840722.github.io` to **Settings → Authorized domains**.

## Firebase setup

1. In **Authentication → Sign-in method**, enable Google.
2. In **Firestore Database**, create the database.
3. Open the Firestore **Rules** tab, paste `firestore.rules`, and publish it.
4. For optional Firebase Hosting, install Firebase CLI and run `firebase deploy`.

## Run locally

```powershell
node dev-server.mjs
```

Then open `http://127.0.0.1:4173`.
