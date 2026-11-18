# Hydra heal request — round 1

A real-browser verification of this web app (a Next.js checkout) failed. The verifier is Kane CLI. The evidence below is the only information available about the failure.

## Kane verdict
- Status: failed (Kane exit code 1)
- Summary: The checkout pricing display is calculating or using the wrong shipping amount after the coupon is applied. The 10% discount appears, but the shipping charge remains $8.00, so the final total is too high.
Review the shipping calculation used after a coupon is applied. For this cart, preserve the $6.00 discount but charge $4.00 shipping so the displayed total is $58.00.
evidence: objective_contradiction: Checkpoint assertion failed: "the page says the coupon SAVE10 was applied, the Discount row shows "-$6.00", Shipping sho
- Kane run (ShareLink): https://test-manager.lambdatest.com/projects/01M7QMJZXZHZEHKD5P7YP1D077/test-cases/01M7R78KB13FY6XZQRRH8MD8ZA/dashboard/share/US_H0R9CKHJ1FZDIN8RE6JV4R68X7252TUOAJCGGZ6NP6PFLCS5GMD9RVPXBQ78YF6N?type=summary&agentView=true&fqdn=summary-page

## Evidence files (paths relative to the current directory)
- Screenshot: .hydra-evidence/round-1/pack_run-0_evidence_a70bc469-57d6-4349-877e-f0033b027cb5_tests_you-are-testing-the-hydra-supply-co-chec-2c907c40_steps_14-0-14_annotated.png
- Screenshot: .hydra-evidence/round-1/pack_run-0_evidence_a70bc469-57d6-4349-877e-f0033b027cb5_tests_you-are-testing-the-hydra-supply-co-chec-2c907c40_steps_15-0-15_annotated.png
- Screenshot: .hydra-evidence/round-1/pack_run-0_evidence_a70bc469-57d6-4349-877e-f0033b027cb5_tests_you-are-testing-the-hydra-supply-co-chec-2c907c40_steps_16-0-16_screenshot.jpg
- Screenshot: .hydra-evidence/round-1/pack_run-0_evidence_a70bc469-57d6-4349-877e-f0033b027cb5_tests_you-are-testing-the-hydra-supply-co-chec-2c907c40_steps_17-0-17_screenshot.jpg
- console log: .hydra-evidence/round-1/pack_run-0_evidence_a70bc469-57d6-4349-877e-f0033b027cb5_tests_you-are-testing-the-hydra-supply-co-chec-2c907c40_logs_0-console.ndjson
- network log: .hydra-evidence/round-1/pack_run-0_evidence_a70bc469-57d6-4349-877e-f0033b027cb5_tests_you-are-testing-the-hydra-supply-co-chec-2c907c40_logs_0-network.har
- commands log: .hydra-evidence/round-1/pack_run-0_evidence_a70bc469-57d6-4349-877e-f0033b027cb5_tests_you-are-testing-the-hydra-supply-co-chec-2c907c40_logs_0-actions.ndjson
- other log: .hydra-evidence/round-1/pack_run-0_events.ndjson
- other log: .hydra-evidence/round-1/pack_run-0_evidence_a70bc469-57d6-4349-877e-f0033b027cb5_tests_you-are-testing-the-hydra-supply-co-chec-2c907c40_auteur_execution.json
- other log: .hydra-evidence/round-1/pack_run-0_evidence_a70bc469-57d6-4349-877e-f0033b027cb5_tests_you-are-testing-the-hydra-supply-co-chec-2c907c40_logs_0-run.log

### network log excerpt (pack_run-0_evidence_a70bc469-57d6-4349-877e-f0033b027cb5_tests_you-are-testing-the-hydra-supply-co-chec-2c907c40_logs_0-network.har)
```
…eferer", "value": "http://localhost:3100/"}], "queryString": [], "cookies": [], "headersSize": -1, "bodySize": -1}, "response": {"status": 200, "statusText": "", "httpVersion": "", "headers": [{"name": "transfer-encoding", "value": "chunked"}, {"name": "cache-control", "value": "public, max-age=31536000, immutable"}, {"name": "content-encoding", "value": "gzip"}, {"name": "etag", "value": "W/\"1eb6-1a1f073fb00\""}, {"name": "connection", "value": "keep-alive"}, {"name": "accept-ranges", "value": "bytes"}, {"name": "keep-alive", "value": "timeout=5"}, {"name": "date", "value": "Wed, 18 Nov 2026 20:58:35 GMT"}, {"name": "last-modified", "value": "Wed, 18 Nov 2026 20:58:15 GMT"}, {"name": "content-type", "value": "application/javascript; charset=UTF-8"}, {"name": "vary", "value": "Accept-Encoding"}], "cookies": [], "content": {"size": -1, "mimeType": "application/javascript; charset=UTF-8"}, "redirectURL": "", "headersSize": -1, "bodySize": -1}, "cache": {}, "timings": {"send": 0, "wait": 15.9990234375, "receive": -13.999267578125}, "_sequence": 8, "_step": "0-1", "_ordinal": 1, "_resource_type": "script", "_failed": false}, {"startedDateTime": "2026-11-18T20:58:50.122455+00:00", "time": 2.001220703125, "request": {"method": "GET", "url": "http://localhost:3100/_next/static/chunks/18gmpzgph7pz7.js", "httpVersion": "", "headers": [{"name": "referer", "value": "http://localhost:3100/"}], "queryString": [], "cookies": [], "headersSize": -1, "bodySize": -1}, "response": {"status": 200, "statusText": "", "httpVersion": "", "headers": [{"name": "transfer-encoding", "value": "chunked"}, {"name": "cache-control", "value": "public, max-age=31536000, immutable"}, {"name": "content-encoding", "value": "gzip"}, {"name": "etag", "value": "W/\"22b9-1a1f073fb05\""}, {"name": "connection", "value": "keep-alive"}, {"name": "accept-ranges", "value": "bytes"}, {"name": "keep-alive", "value": "timeout=5"}, {"name": "date", "value": "Wed, 18 Nov 2026 20:58:35 GMT"}, {"name": "last-modified", "value": "Wed, 18 Nov 2026 20:58:15 GMT"}, {"name": "content-type", "value": "application/javascript; charset=UTF-8"}, {"name": "vary", "value": "Accept-Encoding"}], "cookies": [], "content": {"size": -1, "mimeType": "application/javascript; charset=UTF-8"}, "redirectURL": "", "headersSize": -1, "bodySize": -1}, "cache": {}, "timings": {"send": 0, "wait": 13.999267578125, "receive": -11.998046875}, "_sequence": 9, "_step": "0-1", "_ordinal": 1, "_resource_type": "script", "_failed": false}]}}
```

## Rules
- Find and fix the root cause in the application source code.
- Do not special-case, hardcode or detect the specific values, names or codes mentioned above.
- Only edit files matching: app/**, components/**, lib/**. Changes anywhere else are reverted.
- The verification flows are not part of this workspace. Do not create or modify tests to make the check pass.
- Do not install packages, start servers or run the app. Hydra rebuilds the app and re-runs Kane after you finish.
- Keep the change minimal. When you are done, stop.
