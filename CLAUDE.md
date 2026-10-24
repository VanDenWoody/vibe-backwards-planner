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
- Add a mockup of what changed when the change is visible, built from the existing `.m-*` mockup classes and the app's colour tokens. If phone and desktop look or behave differently, show both. Everything stays dark mode.
- Small changes go in that date's "Also new" list instead of getting their own section.
- Feature ids are prefixed with the date (`id="2026-10-24-sync"`) so they stay unique.
- Update the `description` and `og:description` meta tags to name the latest date and its main features.
- Leave `release-notes/preview.png` alone unless the app's look changes; it has no date on purpose.
- Check the page at 375px wide in the preview: no horizontal scroll, and headings read correctly.
