# Margo ✏️

**A friendly home for your documents.** Margo reads and edits Markdown, Word, Excel, and PDF files in one clean app — Light, Dark, Paper, Graphite, or Ink themes. Fully offline.

*The name comes from “margin” — where all the good notes live. The pencil with the face is Margo herself.*

## Formats

| Open | Edit with | Save / export as |
| --- | --- | --- |
| `.md` `.markdown` `.txt` | Markdown editor with live preview | `.md` · `.docx` · `.html` · `.txt` |
| `.docx` | Rich text editor with font controls | `.docx` · `.md` · `.html` |
| `.xlsx` `.csv` | Spreadsheet grid, multiple sheets | `.xlsx` · `.csv` (active sheet) · `.pdf` |
| `.pdf` | Viewer + signatures + image extraction; **File → New → PDF document** for a blank page | `.pdf` (signatures burned in) |

Markdown and Word documents also export to `.pdf` (File → Export as PDF).

## Features

- **Menu bar** — File / Edit / View / Help: **New** (Markdown note, Word document, Spreadsheet, PDF document), Open, Open Recent, Save, Save As, **Export as PDF** (`Ctrl+E`) and **Print** (`Ctrl+P`, native dialog; PDFs print the open file, including an unsaved blank), Edit commands, appearance & layout options
- **Sliding sidebar library** — auto-hides; hover the left edge to slide it in, or pin it (View → Pin sidebar). Recents with typed first-page thumbnails (MD / DOC / XLS / PDF)
- **Desktop / Explorer** — after installing the built app, files show **typed icons** (gold MD, blue DOC, green XLS, red PDF) instead of the Margo pencil. Saved **DOCX** also embeds a first-page preview for Large-icons view when Windows/Office can read it. PDF/XLSX content previews come from the OS handlers.
- **Markdown** — Write / Split / Read modes with live preview; **headings outline** and **document statistics**; **Ctrl+scroll** to zoom
- **Word documents** — headings, **font family / size / color**, bold/italic/underline/strike, lists, alignment, links; **headings outline** and **document statistics**; **Add page** (`+` bottom-right); **Ctrl+scroll** zoom
- **Spreadsheets** — keyboard navigation (arrows, Enter, Tab, F2), formula bar, sheet tabs, per-cell undo/redo; **Ctrl+scroll** zoom
- **PDF** — **File → New → PDF document** creates a blank US Letter page; smooth zoomable viewer (**Ctrl+scroll** or toolbar), **draw & place signatures** (burned into the file on save), **extract embedded images at original resolution** (copy to clipboard or save as PNG)
- Cross-format save: markdown ↔ Word, sheet → CSV
- **Appearance themes** — View → Appearance: Light, Dark, Paper, Graphite, Ink (remembered); titlebar cycles themes
- **Updates** — installed copies check GitHub Releases on launch (Help → Settings, or Help → Check for updates…). `npm start` cannot auto-update.
- **Share to Google Drive** (optional) — File → Share… uploads the open file as-is and lets you grant Viewer / Commenter / Editor to Google accounts. **File → Open from Drive…** lists the Margo folder and downloads a copy to Documents\Margo. Sign in from the titlebar avatar or Settings. The app still works fully offline if you never sign in.
- Themed **Save changes?** prompt when closing with unsaved edits; shortcuts (`Ctrl+O/S/Shift+S`)
- **Crash recovery** — unsaved edits are drafted locally (not over the original file); after a crash, Restore or Discard on next launch

## Run

```bash
npm install
npm start
```

## Test

```bash
npm test          # end-to-end smoke suite (isolated userData)
```

## Build a Windows installer

```bash
npm run icons   # app + per-type Explorer icons
npm run dist    # NSIS installer in dist/
```

After install, Explorer shows branded icons for MD/DOC/XLS/PDF (not the pencil app icon). Saved Word files also embed a first-page thumbnail (Large / Extra large icons). If you still see the old pencil icon, rebuild/reinstall, then refresh the icon cache (e.g. restart Explorer or delete `%LocalAppData%\IconCache.db` and sign out).

## Ship a new version (GitHub auto-update)

Installed apps pull updates from [GitHub Releases](https://github.com/sounak1125/margo/releases). `npm start` is unpackaged and will not download updates.

1. Bump `"version"` in `package.json` so it matches the tag you will push (e.g. `1.4.0`).
2. Commit the bump.
3. Tag and push: `git tag v1.4.0` then `git push origin v1.4.0`.
4. GitHub Actions builds the Windows NSIS installer and publishes a Release that includes the installer **and** `latest.yml` (required by the updater).

On next launch, an installed Margo downloads the update in the background. When it is ready, users get a restart prompt (Help → Settings also has **Check for updates** / **Restart and install**). Installing a per-machine build may show a Windows UAC prompt — that is expected.

## Google Drive share

Sign-in and upload run in the main process. Editing stays local; Share copies the current file into a **Margo** folder on Drive and sets people + roles (Viewer / Commenter / Editor). **File → Open from Drive…** lists that folder, downloads a copy into `Documents\Margo`, and opens it. Save (when signed in) updates the same Drive file. Commenter is Drive’s file comments, not comments inside Margo. There is no live co-editing and no “anyone with the link.”

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project.
2. Enable the **Google Drive API**.
3. Configure the OAuth consent screen (External). While it is in **Testing**, only listed **test users** can sign in. Publishing (and usually Google verification) is required for other Google accounts — `drive.file` is a sensitive scope. Packaging the client ID does not skip this.
4. Create an OAuth client ID of type **Desktop app**.
5. For local `npm start`: copy `src/main/google-oauth.example.json` to `src/main/google-oauth.json` and put the client ID and secret there. Or set `MARGO_GOOGLE_CLIENT_ID` / `MARGO_GOOGLE_CLIENT_SECRET`.
6. Restart Margo, then **Sign in with Google** (titlebar or Settings) and use **File → Share…** or **File → Open from Drive…**.

Installer / GitHub Release builds bake those credentials in at pack time. Add repo Actions secrets **`MARGO_GOOGLE_CLIENT_ID`** and **`MARGO_GOOGLE_CLIENT_SECRET`** (same values as `google-oauth.json`). `npm run dist` writes that file from the secrets, then electron-builder packs it. The file stays gitignored; do not commit it. If both the file and the secrets are missing, the release build fails on purpose so Drive sign-in is not shipped unconfigured.

`drive.file` only covers files Margo uploads. Refresh tokens stay in the app userData folder, never in the repo.

Verify assets anytime with:

```bash
npm run check:desktop-thumbs
npm run check:desktop-thumbs -- --open   # opens a sample DOCX folder in Explorer
```

## Notes & limits

- Excel **formulas are not preserved** — Margo reads computed values and saves plain values.
- Word **fonts/colors apply and export to .docx**, but reopening a .docx re-derives clean semantic content (mammoth), so exotic styling from other apps may be simplified.
- PDF **text is not editable** (view, sign, extract) — that's true of every JS PDF stack; signatures & images are the supported edits.
- Legacy `.doc` / `.xls` binaries aren’t supported (convert to `.docx` / `.xlsx` first).
- CSV export writes the active sheet only (Margo tells you when it does).
- **Google Drive share** is optional and offline-safe. Commenter access is Drive file comments, not in-app collaboration. Margo can only share or reopen files it uploaded (`drive.file` scope). Open from Drive downloads into Documents\Margo; Save updates Drive only when you are signed in and that file is already mapped.
- **Desktop thumbnails:** typed Explorer icons require a **machine install** (`npm run dist`, `perMachine: true`). If every file shows the Margo pencil, the type icons did not register — reinstall and clear the icon cache. True live first-page previews for Markdown need a Windows shell extension (not shipped); PDF/XLSX use the OS handlers; DOCX embeds a preview image on save.

## Stack

Electron · vanilla JS renderer (no bundler) · [mammoth](https://github.com/mwilliamson/mammoth.js) (docx → HTML) · [html-to-docx](https://github.com/privateOmega/html-to-docx) (HTML → docx) · [marked](https://github.com/markedjs/marked) + [DOMPurify](https://github.com/cure53/DOMPurify) (markdown) · [turndown](https://github.com/mixmark-io/turndown) (HTML → markdown) · [ExcelJS](https://github.com/exceljs/exceljs) (xlsx/csv) · [PDF.js](https://mozilla.github.io/pdf.js/) (PDF rendering/extraction) · [pdf-lib](https://pdf-lib.js.org/) (signature burn-in)

---

Made by Sounak
