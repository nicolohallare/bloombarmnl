# Bloom Bar MNL — New Site

Static, deploy-ready site for bloombarmnl.com.

## Files

- `index.html` — the entire site (single page, anchor navigation matching the current site structure)
- `robots.txt` — tells search engines where to find the sitemap
- `sitemap.xml` — single-page sitemap for Google Search Console

## Deployment (Netlify drag-and-drop, ~5 minutes)

1. Download this folder as a ZIP
2. Go to https://app.netlify.com/drop
3. Drag the folder onto the page
4. Site goes live at a random Netlify subdomain (e.g. `lucky-cat-1234.netlify.app`)
5. Test thoroughly on the Netlify URL before pointing the real domain
6. When ready, in Netlify: Site → Domain settings → Add custom domain → bloombarmnl.com
7. Update DNS at the registrar to point to Netlify (instructions provided in Netlify)
8. Free SSL certificate auto-provisions in ~10 minutes

## Things to do before launching to bloombarmnl.com

- [ ] Confirm pricing with Izza (currently placeholder)
- [ ] Replace the before/after slider images with real before/after pairs
- [ ] Verify all images load (they're currently hot-linked from the current site's CDN — re-host them on Cloudinary or download into an `/images` folder before going live, in case current host eventually deletes them)
- [ ] Test on real mobile devices
- [ ] Run through the lighthouse audit (target 90+ on all 4 scores)
- [ ] Have Izza review all copy

## Tech notes

- Tailwind via CDN (no build step)
- Vanilla JS for slider/quiz/FAQ (no framework)
- Schema.org structured data already embedded (LocalBusiness + FAQ)
- Open Graph tags set
- Mobile-first, sticky CTA bar on phones
