# Zeezeef — X capture (research) · WIP

*Dutch for "sea-sieve."* A Chrome (Manifest V3) browse-and-capture extension for
X / Twitter posts → **NDJSON**, for research. A Chromium-side counterpart to
[Zeeschuimer](https://github.com/digitalmethodsinitiative/zeeschuimer).

> **🚧 Work in progress** — early and under active development. Interfaces,
> output, and behavior will change; not production-ready.

> Independent project — **not affiliated with or endorsed by** the Digital
> Methods Initiative or 4CAT.

## Install (load unpacked)

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this folder.
3. Pin the toolbar icon. (Chrome / Chromium 111+.)

## Use

Browse X while logged in; the extension collects posts as you go. Click the icon
for the running count, **Export NDJSON**, or **Reset**. Sessions can optionally be
sent to a local [4CAT](https://github.com/digitalmethodsinitiative/4cat) instance.

Output is NDJSON, one post per line, in two views: a simplified analysis schema
(download) and raw records (4CAT).

## Ethics & terms

For academic research, on your own account. X data is subject to X's Terms of
Service — run this in line with your institution's data-protection / ethics
review, and collect only what your research needs.

## Develop

```bash
npm test   # extractor unit tests
```

## License

MIT.
