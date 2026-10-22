# Wikipedia Random Article Card

A Home Assistant dashboard card that shows a random Wikipedia article – image, title,
short description and the first paragraphs – and switches to a new one every few minutes.
Made for wall displays and kiosks, but works on any dashboard.

- Any Wikipedia language, or several mixed at random (`en, de`)
- Keeps life dates and other details in parentheses, e.g. *(born April 25, 1975)*
- One paragraph or more; further paragraphs continue into the article's sections, with headings
- Optional line limit with a soft fade on the last line
- Skips disambiguation pages and, if you like, articles without an image
- No sensor, no API key: your browser fetches the article directly from Wikipedia
- Every option is available in the visual card editor

## Installation

### HACS

1. In HACS, open the menu (⋮) → **Custom repositories**.
2. Add `https://github.com/DevHovAI/wikipedia-card` with type **Dashboard**.
3. Search for **Wikipedia Random Article Card** and download it.
4. Reload the browser.

### Manual

1. Copy `wikipedia-card.js` to `<config>/www/`.
2. Add it under *Settings → Dashboards → ⋮ → Resources* as a JavaScript module:
   `/local/wikipedia-card.js?v=1.0.0` (change the `v` after every update).
3. Reload the browser.

## Configuration

Add the card through *Add card → Wikipedia Random Article*, or in YAML:

```yaml
type: custom:wikipedia-card
language: en
interval: 5
paragraphs: 2
```

| Option | Default | Description |
|---|---|---|
| `language` | `en` | Wikipedia language code. Several codes separated by commas are picked at random per article. |
| `interval` | `5` | Minutes until the next article. |
| `paragraphs` | `1` | Number of paragraphs (1–20). From the second one on, text continues into the following sections, with their headings. Reference sections are left out. |
| `max_lines` | `0` | Limit the text to this many lines; the last line fades out. `0` = no limit. |
| `show_image` | `true` | Show the article image. |
| `only_with_image` | `true` | Prefer articles that have an image. |
| `image_height` | `200` | Image height in pixels; the image is cropped to fill the width. |
| `show_description` | `true` | Show the short description below the title. |
| `show_attribution` | `true` | Show the source line "Wikipedia · CC BY-SA 4.0". |

## How it works

The card asks the Wikipedia API for a handful of random titles, checks each one's summary
(page type, image, description) and takes the first that fits. The text comes from the
article's plain-text extract, because the summary leaves out everything in parentheses.
Requests go from the browser that shows the dashboard straight to Wikipedia; Home Assistant
is not involved. If Wikipedia cannot be reached, the current article stays and the card
tries again a minute later.

## License

Code: MIT, see [LICENSE](LICENSE).
Article text and images come from Wikipedia and Wikimedia Commons under their own licenses
(text: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)); keep the source line
switched on when you show them publicly.
