# Hydra heal request — round 1

A real-browser verification of this web app (a Next.js checkout) failed. The verifier is Kane CLI. The evidence below is the only information available about the failure.

## Kane verdict
- Status: failed (Kane exit code 1)
- Summary: The checkout calculation used the wrong shipping amount after applying the coupon, so the final total was $4.00 too high and the required payment button amount was unavailable.
Inspect the checkout pricing rules that recalculate shipping after SAVE10 is applied. For this cart, the discounted checkout must show Shipping $4.00, Discount -$6.00, Total $58.00, and a Pay $58.00 button.
evidence: objective_contradiction: SAVE10 applied, but Shipping is $8.00 and Total is $62.00, so Pay $58.00 does not exist.
- Kane run (ShareLink): https://test-manager.lambdatest.com/projects/01M7QMJZXZHZEHKD5P7YP1D077/test-cases/01M7R3073G6H6CWCB39QR1BJS6/dashboard/share/US_TPIIZO66YU9SF9BSSTS3Z8HL3V7Q2KDBI53ADXJ4CEXJM8UAZHU20AO4AB1WFVDA?type=summary&agentView=true&fqdn=summary-page

## Evidence files (paths relative to the current directory)
- Screenshot: .hydra-evidence/round-1/pack_run-0_evidence_39835938-b70a-49b4-8b15-a7ce8960c9ea_tests_you-are-testing-the-hydra-supply-co-chec-45ddc5a2_steps_14-0-14_screenshot.jpg
- Screenshot: .hydra-evidence/round-1/pack_run-0_evidence_39835938-b70a-49b4-8b15-a7ce8960c9ea_tests_you-are-testing-the-hydra-supply-co-chec-45ddc5a2_steps_15-0-15_annotated.png
- Screenshot: .hydra-evidence/round-1/pack_run-0_evidence_39835938-b70a-49b4-8b15-a7ce8960c9ea_tests_you-are-testing-the-hydra-supply-co-chec-45ddc5a2_steps_16-0-16_annotated.png
- Screenshot: .hydra-evidence/round-1/pack_run-0_evidence_39835938-b70a-49b4-8b15-a7ce8960c9ea_tests_you-are-testing-the-hydra-supply-co-chec-45ddc5a2_steps_17-0-17_screenshot.jpg
- console log: .hydra-evidence/round-1/pack_run-0_evidence_39835938-b70a-49b4-8b15-a7ce8960c9ea_tests_you-are-testing-the-hydra-supply-co-chec-45ddc5a2_logs_0-console.ndjson
- network log: .hydra-evidence/round-1/pack_run-0_evidence_39835938-b70a-49b4-8b15-a7ce8960c9ea_tests_you-are-testing-the-hydra-supply-co-chec-45ddc5a2_logs_0-network.har
- commands log: .hydra-evidence/round-1/pack_run-0_evidence_39835938-b70a-49b4-8b15-a7ce8960c9ea_tests_you-are-testing-the-hydra-supply-co-chec-45ddc5a2_logs_0-actions.ndjson
- other log: .hydra-evidence/round-1/pack_run-0_code-export_requirements.txt
- other log: .hydra-evidence/round-1/pack_run-0_events.ndjson
- other log: .hydra-evidence/round-1/pack_run-0_evidence_39835938-b70a-49b4-8b15-a7ce8960c9ea_tests_you-are-testing-the-hydra-supply-co-chec-45ddc5a2_auteur_execution.json

### network log excerpt (pack_run-0_evidence_39835938-b70a-49b4-8b15-a7ce8960c9ea_tests_you-are-testing-the-hydra-supply-co-chec-45ddc5a2_logs_0-network.har)
```
…eferer", "value": "http://localhost:3100/"}], "queryString": [], "cookies": [], "headersSize": -1, "bodySize": -1}, "response": {"status": 200, "statusText": "", "httpVersion": "", "headers": [{"name": "transfer-encoding", "value": "chunked"}, {"name": "cache-control", "value": "public, max-age=31536000, immutable"}, {"name": "content-encoding", "value": "gzip"}, {"name": "etag", "value": "W/\"1eb6-1a1f02f7bec\""}, {"name": "connection", "value": "keep-alive"}, {"name": "accept-ranges", "value": "bytes"}, {"name": "keep-alive", "value": "timeout=5"}, {"name": "date", "value": "Wed, 18 Nov 2026 19:44:06 GMT"}, {"name": "last-modified", "value": "Wed, 18 Nov 2026 19:43:26 GMT"}, {"name": "content-type", "value": "application/javascript; charset=UTF-8"}, {"name": "vary", "value": "Accept-Encoding"}], "cookies": [], "content": {"size": -1, "mimeType": "application/javascript; charset=UTF-8"}, "redirectURL": "", "headersSize": -1, "bodySize": -1}, "cache": {}, "timings": {"send": 0, "wait": 37.903076171875, "receive": -34.28662109375}, "_sequence": 8, "_step": "0-1", "_ordinal": 1, "_resource_type": "script", "_failed": false}, {"startedDateTime": "2026-11-18T19:44:42.981152+00:00", "time": 4.7705078125, "request": {"method": "GET", "url": "http://localhost:3100/_next/static/chunks/2f3imjgjobo1b.js", "httpVersion": "", "headers": [{"name": "referer", "value": "http://localhost:3100/"}], "queryString": [], "cookies": [], "headersSize": -1, "bodySize": -1}, "response": {"status": 200, "statusText": "", "httpVersion": "", "headers": [{"name": "transfer-encoding", "value": "chunked"}, {"name": "cache-control", "value": "public, max-age=31536000, immutable"}, {"name": "content-encoding", "value": "gzip"}, {"name": "etag", "value": "W/\"22b9-1a1f02f7c01\""}, {"name": "connection", "value": "keep-alive"}, {"name": "accept-ranges", "value": "bytes"}, {"name": "keep-alive", "value": "timeout=5"}, {"name": "date", "value": "Wed, 18 Nov 2026 19:44:06 GMT"}, {"name": "last-modified", "value": "Wed, 18 Nov 2026 19:43:26 GMT"}, {"name": "content-type", "value": "application/javascript; charset=UTF-8"}, {"name": "vary", "value": "Accept-Encoding"}], "cookies": [], "content": {"size": -1, "mimeType": "application/javascript; charset=UTF-8"}, "redirectURL": "", "headersSize": -1, "bodySize": -1}, "cache": {}, "timings": {"send": 0, "wait": 34.28662109375, "receive": -29.51611328125}, "_sequence": 9, "_step": "0-1", "_ordinal": 1, "_resource_type": "script", "_failed": false}]}}
```

## Rules
- Find and fix the root cause in the application source code.
- Do not special-case, hardcode or detect the specific values, names or codes mentioned above.
- Only edit files matching: app/**, components/**, lib/**. Changes anywhere else are reverted.
- The verification flows are not part of this workspace. Do not create or modify tests to make the check pass.
- Do not install packages, start servers or run the app. Hydra rebuilds the app and re-runs Kane after you finish.
- Keep the change minimal. When you are done, stop.
