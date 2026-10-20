# Facebook shared-reel diagnosis, 20 October 2026

The failed `facebook.com/share/r/1PjrajmZk1/` request fetched successfully in Apify run
`CrIOOLBVm579ghTFX`. The adapter expected the ordinary-video response shape and missed the
shared reel's nested video URLs, duration and caption. An earlier failed share link
(`nrrejj0E4NWF3frwc`) had the same shape. An ordinary-video run (`z7UAOMgMgnphyrn6W`)
retains the original root fields.

## Before/after adapter replay

Three existing service results were replayed through the old and updated Facebook field
mappings, with no new actor or model call. Signed media URLs and tracking data are omitted.

| Metric | Before | After |
|---|---|---|
| Video recognized | 1/3 | 3/3 |
| Caption recognized | 1/3 | 3/3 |
| Shared-reel duration recognized | 0/2 | 2/2 (20.431 s) |
| Ordinary-video result preserved | yes | yes (66.73 s) |
| Service/model cost of adapter replay | $0 | $0 |

Local parser times were below 1 ms, excluding network I/O. These three results validate
response-shape compatibility, not end-to-end extraction quality across arbitrary posts.
Raw metrics: `facebook-share-parser-2026-10-20.json`.

## Live source verification

The original shared reel's CDN video downloaded and decoded successfully (20.43 s, four
frames). Its speech describes the finished chicken/rice/broccoli/coconut-curry-broth dish;
the caption asks viewers to comment EAT. The real transcription and extraction calls did
not produce a complete grounded recipe. This remains an unsuccessful recipe import;
reading the media successfully does not make the preview a full recipe. Model and
transcription cost for that check: $0.03138; prior service data was reused, with no new
actor charge. An additional diagnostic transcription and manual frame inspection confirmed
the source limitation.

The updated message distinguishes this from an inaccessible/unreadable video:
“Pantrio read this video but couldn't find a complete recipe. Try the creator's recipe-page link.”
Fetch/decode failures retain their existing fallback behavior. No ingredients or cooking
steps are invented to turn a preview into a recipe.

The matching recipe was found on the creator's site:
[Chicken Broth Bowl](https://www.chelseasmessyapron.com/chicken-broth-bowl/).
The real link import returned a saveable draft with 25 ingredient lines and 10 steps;
65.5 s, $0.04897 model cost. No recipe was saved to the owner's account.
Raw summaries: `facebook-share-live-2026-10-20.json` and
`facebook-share-recipe-page-2026-10-20.json`.

## Regression coverage

- Ordinary Facebook video and nested shared-reel field mapping, including duration and credit.
- Link-only shared-reel import through service lookup, video decoding and extraction.
- A comment-only caption falls through to the video's recipe rather than ending the import.
- One service run per import; authorization never forwarded to the video CDN.
- Successfully read videos without a recipe get the specific message; unreadable media does not.

No extraction prompt, model, API schema or database changes.
