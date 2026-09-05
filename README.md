# Twogether

A small, private, real-time couple-question app designed for iPhone and GitHub Pages.

## The flow

1. The first person enters their name and a private share code.
2. Twogether generates an invite link to send through Messages.
3. The second person opens the link and enters their own name.
4. Both answer questions on their own phone.
5. Each screen updates live to show which questions both people answered.
6. Either person taps **Reveal this answer** and it opens on both screens at once.

Answers are saved separately by room, role, and participant ID. This also means the host and invite link can be tested in two tabs of the same browser without sharing one person's answers.

## Architecture and privacy

- Static HTML, CSS, and JavaScript; compatible with GitHub Pages.
- No account, analytics, application server, or database.
- PeerJS/WebRTC provides the live peer-to-peer data connection.
- A BroadcastChannel fallback provides the same live behavior when testing the host and invite in two tabs of one browser.
- The free PeerJS Cloud service is used only to help the two devices establish their connection.
- WebRTC traffic is encrypted in transit.
- Unrevealed answer text is kept on its owner's device. Only answered/not-answered status is sent before reveal.
- Both devices must be online with the app open for live updates. There is no server-side recovery if local Safari data is cleared.

For higher reliability across restrictive mobile networks, host a private PeerServer with TURN support or use a small real-time backend.

## Publish on GitHub Pages

1. Open **Settings → Pages** in the GitHub repository.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select the `main` branch and `/ (root)`, then save.
4. In iPhone Safari, use **Share → Add to Home Screen**.

## Run locally

```powershell
node dev-server.mjs
```

Then open `http://127.0.0.1:4173`.
