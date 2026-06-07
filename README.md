# Arete Care · Signature Portal

A lightweight, client-side web app for signing two fixed Arete Care documents — the
**Service Agreement** and the **Schedule of Supports** — with pre-positioned
signature, date, tick-box and fill-in fields. Everything runs in the browser; no
files are uploaded to a server.

## How it works

1. **Choose a document** — a modal asks whether you're signing the Service Agreement
   or the Schedule of Supports.
2. **Upload the PDF** — drag & drop or browse for the file.
3. **Sign** — the full document is previewed (all pages). Draw each required
   signature, set the date (defaults to today, editable), tick the relevant boxes
   and fill in any blanks directly on the page. Typing in a blank auto-ticks its box.
4. **Download** — the signed, flattened PDF is generated locally.

The signature/checkbox/field positions are hard-coded per document (the PDFs are
constant), so the fields always land in the right place.

## Tech

- Plain HTML/CSS/JS — no build step.
- [pdf.js](https://mozilla.github.io/pdf.js/) for rendering the preview.
- [pdf-lib](https://pdf-lib.js.org/) for writing signatures/ticks/text into the PDF.
- [signature_pad](https://github.com/szimek/signature_pad) for drawing signatures.

## Running

It's a static site — just open `index.html` in a browser, or serve the folder with
any static file server.

## Project structure

```
index.html        # markup / app shell
css/style.css     # Arete Care themed, responsive styles
js/app.js         # all app logic + per-document field coordinates
assets/           # logo (sample PDFs are gitignored — they contain participant data)
libs/             # pdf.js, pdf-lib, signature_pad
```
