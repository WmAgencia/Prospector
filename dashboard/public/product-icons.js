/*!
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

The following Lucide icons are derived from the Feather project:

airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out

The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/
// Lucide icons. Source commit ee8e10d746a10907205366cfd984922f0c58939a. ISC/MIT notices: docs/licenses/lucide.txt
(()=>{const paths={"overview":"<rect width=\"7\" height=\"9\" x=\"3\" y=\"3\" rx=\"1\" />\n  <rect width=\"7\" height=\"5\" x=\"14\" y=\"3\" rx=\"1\" />\n  <rect width=\"7\" height=\"9\" x=\"14\" y=\"12\" rx=\"1\" />\n  <rect width=\"7\" height=\"5\" x=\"3\" y=\"16\" rx=\"1\" />","conversations":"<path d=\"M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z\" />\n  <path d=\"M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1\" />","prospects":"<path d=\"M3 7V5a2 2 0 0 1 2-2h2\" />\n  <path d=\"M17 3h2a2 2 0 0 1 2 2v2\" />\n  <path d=\"M21 17v2a2 2 0 0 1-2 2h-2\" />\n  <path d=\"M7 21H5a2 2 0 0 1-2-2v-2\" />\n  <circle cx=\"12\" cy=\"12\" r=\"3\" />\n  <path d=\"m16 16-1.9-1.9\" />","connections":"<path d=\"M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z\" />\n  <path d=\"m2 22 3-3\" />\n  <path d=\"M7.5 13.5 10 11\" />\n  <path d=\"M10.5 16.5 13 14\" />\n  <path d=\"m18 3-4 4h6l-4 4\" />","settings":"<path d=\"M14 17H5\" />\n  <path d=\"M19 7h-9\" />\n  <circle cx=\"17\" cy=\"17\" r=\"3\" />\n  <circle cx=\"7\" cy=\"7\" r=\"3\" />","refresh":"<path d=\"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8\" />\n  <path d=\"M21 3v5h-5\" />\n  <path d=\"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16\" />\n  <path d=\"M8 16H3v5\" />","arrow":"<path d=\"M5 12h14\" />\n  <path d=\"m12 5 7 7-7 7\" />","search":"<path d=\"m21 21-4.34-4.34\" />\n  <circle cx=\"11\" cy=\"11\" r=\"8\" />","menu":"<path d=\"M4 5h16\" />\n  <path d=\"M4 12h16\" />\n  <path d=\"M4 19h16\" />","close":"<path d=\"M18 6 6 18\" />\n  <path d=\"m6 6 12 12\" />","check":"<path d=\"M20 6 9 17l-5-5\" />","clients":"<path d=\"M18 21a8 8 0 0 0-16 0\" />\n  <circle cx=\"10\" cy=\"8\" r=\"5\" />\n  <path d=\"M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3\" />","training":"<path d=\"M12 13h4\" />\n  <path d=\"M12 18h6a2 2 0 012 2v1\" />\n  <path d=\"M12 8h8\" />\n  <path d=\"M12 9a4.17 4.17 0 01-3 4\" />\n  <path d=\"M16 8V5a2 2 0 012-2\" />\n  <path d=\"M6 18a4 4 0 01-2-7.465\" />\n  <path d=\"M6.004 5.125a4 4 0 00-2.526 5.77\" />\n  <path d=\"M6.294 6.294A3 3 0 1112 5v13a4 4 0 11-7.967-.518\" />\n  <circle cx=\"16\" cy=\"13\" r=\"0.5\" fill=\"currentColor\" />\n  <circle cx=\"18\" cy=\"3\" r=\"0.5\" fill=\"currentColor\" />\n  <circle cx=\"20\" cy=\"21\" r=\"0.5\" fill=\"currentColor\" />\n  <circle cx=\"20\" cy=\"8\" r=\"0.5\" fill=\"currentColor\" />","credits":"<path d=\"M3 11h3.75a2 2 0 0 1 1.6.8l.45.6a4 4 0 0 0 6.4 0l.45-.6a2 2 0 0 1 1.6-.8H21\" />\n  <path d=\"M3 7h18\" />\n  <rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\" />","radar":"<path d=\"M19.07 4.93A10 10 0 0 0 6.99 3.34\" />\n  <path d=\"M4 6h.01\" />\n  <path d=\"M2.29 9.62A10 10 0 1 0 21.31 8.35\" />\n  <path d=\"M16.24 7.76A6 6 0 1 0 8.23 16.67\" />\n  <path d=\"M12 18h.01\" />\n  <path d=\"M17.99 11.66A6 6 0 0 1 15.77 16.67\" />\n  <circle cx=\"12\" cy=\"12\" r=\"2\" />\n  <path d=\"m13.41 10.59 5.66-5.66\" />","send":"<path d=\"M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z\" />\n  <path d=\"m21.854 2.147-10.94 10.939\" />","bell":"<path d=\"M10.268 21a2 2 0 0 0 3.464 0\" />\n  <path d=\"M22 8c0-2.3-.8-4.3-2-6\" />\n  <path d=\"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326\" />\n  <path d=\"M4 2C2.8 3.7 2 5.7 2 8\" />","shield":"<path d=\"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z\" />\n  <path d=\"m9 12 2 2 4-4\" />","chart":"<path d=\"M12 16v5\" />\n  <path d=\"M16 14.639V21\" />\n  <path d=\"M20 10.656V21\" />\n  <path d=\"m22 3-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15\" />\n  <path d=\"M4 18.463V21\" />\n  <path d=\"M8 14.656V21\" />","route":"<circle cx=\"6\" cy=\"19\" r=\"3\" />\n  <path d=\"M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15\" />\n  <circle cx=\"18\" cy=\"5\" r=\"3\" />","play":"<path d=\"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z\" />","pause":"<rect x=\"14\" y=\"3\" width=\"5\" height=\"18\" rx=\"1\" />\n  <rect x=\"5\" y=\"3\" width=\"5\" height=\"18\" rx=\"1\" />","sparkles":"<path d=\"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z\" />\n  <path d=\"M20 2v4\" />\n  <path d=\"M22 4h-4\" />\n  <circle cx=\"4\" cy=\"20\" r=\"2\" />"};globalThis.ProspectorIcons={svg(key,className="icon"){return `<svg class="${className}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[key]||paths.sparkles}</svg>`;}};})();
