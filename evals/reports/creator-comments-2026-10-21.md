# Creator comment links, 21 October 2026

Imports of social posts now read the post's top comments before the video, keeping only comments by
the post's creator, and try a recipe-site link from them through the existing linked-page path.

## Apify comment actors (checked with `scripts/reel_media_check.py --save`)

| Platform | Actor | How the creator's comment is identified | Order | Fee (FREE tier) |
|---|---|---|---|---|
| Facebook | `apify/facebook-comments-scraper` | No author flag. Every comment carries the post page's `pageAdLibrary.uri_token`; the creator's comment has `profileUrl` `facebook.com/<that token>` | Ranked (`RANKED_UNFILTERED`) | $0.001 per run + $0.0025 per comment |
| Instagram | `apify/instagram-comment-scraper` | `ownerUsername` matched to the post's handle; comments name no post owner, so a link without a known handle skips the run | Newest first, no sort option | $0.0026 per comment |
| TikTok | `clockworks/tiktok-comments-scraper` | `uniqueId` matched to the `/@handle/` in `videoWebUrl` (`pinnedByAuthor` also exists) | Ranked; the creator's comment was in the top 10 on the posts checked | $0.00125 per comment |

Runs fetch 10 comments (owner's choice): $0.026 Facebook, $0.026 Instagram, $0.0125 TikTok per lookup.
The original estimate of $0.002-0.005 per run assumed a flat fee; the actors charge per comment
(a 50-comment Facebook run cost $0.126).

Findings on real posts: the Chelsea's Messy Apron Facebook reel's creator link was comment 1 of 50.
On Instagram the same creator answers by DM only (no link comments); on TikTok the creator's
comments say "Google ... or click the link in my bio" with no URL. No real Instagram or TikTok
post with a creator link comment was found, so those fixtures use recorded field names and
authors with edited texts (`tests/data/apify_comments.json`). Instagram's newest-first order means
a creator comment from upload day on a busy post is missed (the video is read instead).

## Reel eval (fake service, real creator filter), `gpt-5.4-mini`

Before `reel-2026-10-21T075706Z` (`--comments off`) vs after `reel-2026-10-21T075731Z`, 9 cases
(2 new: a creator's comment link, a stranger's comment link):

| Metric | Before | After |
|---|---|---|
| Recipe found / refused correctly | 100% | 100% |
| Cases with a missed allergen | 0 | 0 |
| Food matching | 98% | 98% |
| Video service calls as expected | 89% | 100% |
| Recipe site credited as expected | 88% | 100% |
| Pages fetched from strangers' links | 0 | 0 |
| Service fees per import | $0.0032 | $0.0111 |
| Total cost per import | $0.0165 | $0.0236 |
| Latency p50 / p95 | 9.3 s / 26.8 s | 8.4 s / 19.3 s |

The creator-link case now reads the site with no video run. Cost per import rises because Facebook
and TikTok posts with no link anywhere now pay a comments run before the video ($0.013-0.026).
The eval's fake videos are short, so the video read there costs far less than a real reel.

## Live: the Chelsea Facebook reel

`https://www.facebook.com/share/r/1FmTKqfSLP/` (`creator-comments-live-2026-10-21.json`): Chicken
Broth Bowl, 25 lines, 11 steps (the earlier report counted 10), `recipe_url`
`https://www.chelseasmessyapron.com/chicken-broth-bowl/`, no video fetched, one comments run
($0.026), model $0.056, 56.8 s. Before this change the import read the video and found no complete
recipe.
