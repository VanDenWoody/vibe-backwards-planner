# Project instructions

## Changes go through a pull request

Pushing to `main` publishes the live site (GitHub Pages), so nothing lands on `main` without my review.

- Make every change on a new branch cut from an up-to-date `main`. Never commit or push to `main` directly.
- Name the branch after the change with a type prefix, for example `feat/prefill-template-name` or `fix/leave-line-date`.
- When the change is done and verified, push the branch and open a pull request against `main` with `gh pr create`. Describe what changed and how it was verified.
- Do not merge the pull request yourself, and do not enable auto-merge. I review and merge it.

## Every user-facing change updates the release notes

The release notes are one page, `release-notes/index.html`, live at
<https://vandenwoody.github.io/vibe-backwards-planner/release-notes/>. I share
that link with friends, so they read it on a phone.

- Every `feat:` or `fix:` that someone using the app can notice adds an entry to the release notes in the same pull request. Internal changes (tests, refactors, docs, tooling) do not.
- Entries go under a dated section, `<section class="release" id="YYYY-MM-DD">`, newest date at the top, right under the page header. Use the date the pull request is opened. If that date's section already exists, add to it; otherwise create it by copying an existing one.
- The heading (`<h3>`) plainly names what is new, for example "Reorder and insert steps". No catchy phrases or questions.
- Under it, one or two short sentences in plain language for a non-technical friend: what you can do now and how to find it.
- Every image is a real screenshot of the app, never a drawn mockup. Add one for each visible change: write a spec in `tools/release-shots/YYYY-MM-DD.json` (copy an existing one) and run `node tools/release-screenshots.mjs tools/release-shots/YYYY-MM-DD.json` with the local server on port 8000 running. It writes `release-notes/img/YYYY-MM-DD-<name>.png` at 2x in dark mode. Look at every image before using it. If phone and desktop look or behave differently, take both (`"device": "desktop"`); otherwise say "Desktop looks the same" in the caption.
- Use realistic example data in the screenshots, never anything personal.
- Small changes go in that date's "Also new" list instead of getting their own section. Those items are text only, without screenshots.
- The app's "What's new" link shows a dot until the user opens the notes. It reads the date from the first `<section class="release" id="YYYY-MM-DD">` on the page (`whatsnew.js`), so keep that markup and keep the newest release first. A new dated section is all it takes to bring the dot back.
- Add every new feature to the "What's new" contents list at the top of the page, newest first: its plain heading as a link to the feature's id, followed by the release date in muted colour (`<time class="toc__date">24 Oct 2026</time>`). A date with small changes also gets one "Smaller improvements" line linking to its "Also new" list (`id="YYYY-MM-DD-also-new"`).
- Feature ids are prefixed with the date (`id="2026-10-24-sync"`) so they stay unique.
- Give every feature section and every "Also new" list a short `data-toc` name (`data-toc="Template sync"`). The always-visible contents (the bar on phones, the sidebar on wide screens) is built from these and shows where the reader is.
- Update the `description` and `og:description` meta tags to name the latest date and its main features.
- Leave `release-notes/preview.png` alone unless the app's look changes; it has no date on purpose. When it does need redoing, build it from a real screenshot too.
- Check the page at 375px wide in the preview: no horizontal scroll, and headings read correctly.
